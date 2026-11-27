export const QUEUE_MODES = ['1v1', '2v2'];
export const QUEUE_POLL_MS = 5 * 60_000;
export const QUEUE_ACTIVE_MS = 10 * 60_000;
export const QUEUE_REGION = 'brz';
export const QUEUE_PAGES = 10;

export const queueError = code => Object.assign(new Error(code), { queueCode: code });
export const emptyQueueState = () => ({ version: 1, region: QUEUE_REGION, modes: {} });
const integer = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const playerId = value => /^\d+$/.test(String(value)) && integer(value) > 0 ? String(Number(value)) : null;

export function queueName(value) {
  let name = String(value || '');
  // Corrige UTF-8 interpretado como Latin-1 sem danificar nomes que já têm Unicode válido.
  if ([...name].every(character => character.codePointAt(0) <= 255)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) name = decoded;
  }
  return name.normalize('NFC').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function normalizeQueueRow(row, mode) {
  const ids = mode === '2v2' ? [playerId(row?.brawlhalla_id_one), playerId(row?.brawlhalla_id_two)] : [playerId(row?.brawlhalla_id)];
  const games = integer(row?.games), rank = integer(row?.rank), wins = integer(row?.wins);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || games == null || !rank || wins != null && wins > games) throw queueError('RESPONSE');
  return { id: ids.slice().sort((a, b) => Number(a) - Number(b)).join(':'), playerIds: ids,
    name: queueName(mode === '2v2' ? row.teamname : row.name) || ids.join(' + '),
    rank, rating: integer(row.rating), peak: integer(row.peak_rating), tier: queueName(row.tier), games, wins };
}

/** O primeiro retrato é só base; somente aumento de partidas confirma atividade recente. */
export function compareQueueSnapshot(previous, rows, now) {
  const comparable = Boolean(previous?.updatedAt && now > previous.updatedAt && now - previous.updatedAt <= QUEUE_ACTIVE_MS);
  const entries = {};
  for (const row of rows) {
    const before = comparable ? previous.entries[row.id] : null;
    const reset = before && row.games < before.games;
    const continued = before?.lastActivityAt && now - before.lastActivityAt < QUEUE_ACTIVE_MS && !reset;
    const increased = before && row.games > before.games;
    entries[row.id] = { ...row,
      lastActivityAt: increased ? now : continued ? before.lastActivityAt : null,
      since: increased ? continued ? before.since : now : continued ? before.since : null,
      rankBefore: increased ? continued ? before.rankBefore : before.rank : continued ? before.rankBefore : null };
  }
  return { updatedAt: now, attemptedAt: now, errorAt: 0, compared: comparable, entries };
}

export function validQueueState(state) {
  if (state?.version !== 1 || state.region !== QUEUE_REGION || !state.modes || typeof state.modes !== 'object' || Array.isArray(state.modes)) return false;
  return Object.entries(state.modes).every(([mode, snapshot]) => QUEUE_MODES.includes(mode) &&
    snapshot && Number.isFinite(snapshot.updatedAt) && Number.isFinite(snapshot.attemptedAt) && Number.isFinite(snapshot.errorAt) &&
    typeof snapshot.compared === 'boolean' && snapshot.entries && typeof snapshot.entries === 'object' && !Array.isArray(snapshot.entries) &&
    Object.entries(snapshot.entries).every(([id, entry]) => entry?.id === id && Array.isArray(entry.playerIds) &&
      entry.playerIds.length === (mode === '2v2' ? 2 : 1) && new Set(entry.playerIds).size === entry.playerIds.length && entry.playerIds.every(value => playerId(value) === value) &&
      id === entry.playerIds.slice().sort((a, b) => Number(a) - Number(b)).join(':') &&
      typeof entry.name === 'string' && entry.name.length <= 500 && typeof entry.tier === 'string' &&
      Number.isSafeInteger(entry.games) && entry.games >= 0 && Number.isSafeInteger(entry.rank) && entry.rank > 0 &&
      [entry.rating, entry.peak, entry.wins].every(value => value === null || Number.isSafeInteger(value) && value >= 0) &&
      (entry.wins === null || entry.wins <= entry.games) &&
      (entry.lastActivityAt === null || Number.isFinite(entry.lastActivityAt)) &&
      (entry.since === null || Number.isFinite(entry.since)) && (entry.rankBefore === null || integer(entry.rankBefore) > 0)));
}

export function createRankedQueueService({ store, fetchPage, now = Date.now, logger = console }) {
  let state, initialization, cycle;
  const initialize = () => initialization ||= store.read().then(value => { state = value; });
  return {
    initialize,
    async poll() {
      await initialize();
      if (cycle) return cycle;
      cycle = (async () => {
        const results = await Promise.allSettled(QUEUE_MODES.map(async mode => {
          // As páginas de uma modalidade só substituem o retrato anterior se TODAS forem válidas.
          const pages = await Promise.allSettled(Array.from({ length: QUEUE_PAGES }, async (_, page) => {
            const rows = await fetchPage(mode, page + 1);
            if (!Array.isArray(rows) || rows.length > 50) throw queueError('RESPONSE');
            return rows.map(row => normalizeQueueRow(row, mode));
          }));
          const failed = pages.find(result => result.status === 'rejected');
          if (failed) throw failed.reason;
          const rows = new Map();
          for (const row of pages.flatMap(result => result.value)) rows.set(row.id, row);
          return [...rows.values()];
        }));
        const next = structuredClone(state), observedAt = now();
        for (let i = 0; i < QUEUE_MODES.length; i++) {
          const mode = QUEUE_MODES[i], result = results[i];
          if (result.status === 'fulfilled') next.modes[mode] = compareQueueSnapshot(state.modes[mode], result.value, observedAt);
          else {
            next.modes[mode] = { updatedAt: 0, compared: false, entries: {}, ...state.modes[mode], attemptedAt: observedAt, errorAt: observedAt };
            logger.warn(`[QUEUE] Snapshot unavailable for ${mode}; previous data preserved.`);
          }
        }
        await store.write(next);
        state = next;
        return this.snapshot('1v1');
      })().finally(() => { cycle = null; });
      return cycle;
    },
    async snapshot(mode = '1v1') {
      if (!QUEUE_MODES.includes(mode)) throw queueError('MODE');
      await initialize();
      const current = state.modes[mode], time = now();
      const status = !current?.updatedAt ? current?.errorAt ? 'unavailable' : 'warming'
        : current.errorAt || time - current.updatedAt >= QUEUE_ACTIVE_MS ? 'stale' : current.compared ? 'ready' : 'warming';
      const entries = Object.values(current?.entries || {}).filter(entry => entry.lastActivityAt != null && time - entry.lastActivityAt < QUEUE_ACTIVE_MS)
        .sort((a, b) => a.rank - b.rank);
      return { mode, region: state.region.toUpperCase(), status, polling: Boolean(cycle), entries, players: new Set(entries.flatMap(entry => entry.playerIds)).size,
        updatedAt: current?.updatedAt || null, nextCheckAt: (current?.attemptedAt || time) + QUEUE_POLL_MS,
        coverage: QUEUE_PAGES * 50, windowMinutes: QUEUE_ACTIVE_MS / 60_000, observedAt: time };
    },
  };
}
