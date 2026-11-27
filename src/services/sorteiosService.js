import { randomInt, randomUUID } from 'node:crypto';

export const SORTEIO_LIMITS = { minDuration: 60000, maxDuration: 30 * 86400000, maxWinners: 20, maxEntries: 5000, maxActive: 20, draftTtl: 2 * 3600000 };
export const sorteioError = code => Object.assign(new Error(code), { sorteioCode: code });

export function parseSorteioDuration(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const pattern = /(\d+)\s*(dias?|days?|d|horas?|hours?|h|minutos?|minutes?|mins?|m|segundos?|seconds?|secs?|s)/g;
  let total = 0, matched = false;
  const residue = text.replace(pattern, (_, amount, unit) => {
    matched = true;
    total += Number(amount) * ({ d: 86400000, h: 3600000, m: 60000, s: 1000 })[unit[0]];
    return '';
  });
  if (!matched || residue.trim() || !Number.isSafeInteger(total) || total < SORTEIO_LIMITS.minDuration || total > SORTEIO_LIMITS.maxDuration) throw sorteioError('DURATION');
  return total;
}

export function validateSorteioFields(fields, { allowEmptyPrize = false } = {}) {
  const prize = String(fields.prize ?? '').trim();
  const description = String(fields.description ?? '').trim();
  const winnerCount = Number(fields.winnerCount);
  const durationMs = Number(fields.durationMs);
  if ((!prize && !allowEmptyPrize) || prize.length > 150 || description.length > 4000) throw sorteioError('TEXT');
  const title = String(fields.title || '').trim(), footer = String(fields.footer || '').trim();
  const joinLabel = String(fields.joinLabel || '').trim(), leaveLabel = String(fields.leaveLabel || '').trim();
  if (title.length > 200 || footer.length > 200 || joinLabel.length > 40 || leaveLabel.length > 40) throw sorteioError('STYLE');
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > SORTEIO_LIMITS.maxWinners) throw sorteioError('WINNERS');
  if (!['members', 'all'].includes(fields.audience)) throw sorteioError('AUDIENCE');
  if (!Number.isSafeInteger(durationMs) || durationMs < SORTEIO_LIMITS.minDuration || durationMs > SORTEIO_LIMITS.maxDuration) throw sorteioError('DURATION');
  const color = String(fields.color || '#5865F2');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw sorteioError('COLOR');
  const image = String(fields.image || '').trim();
  const thumbnail = String(fields.thumbnail || '').trim();
  for (const address of [image, thumbnail].filter(Boolean)) {
    let url;
    try { url = new URL(address); } catch { throw sorteioError('IMAGE'); }
    if (url.protocol !== 'https:' || url.username || url.password || address.length > 1000) throw sorteioError('IMAGE');
  }
  if (!/^\d{17,20}$/.test(String(fields.channelId))) throw sorteioError('CHANNEL');
  const roleId = fields.roleId == null || fields.roleId === '' ? null : String(fields.roleId);
  if (roleId && !/^\d{17,20}$/.test(roleId)) throw sorteioError('ROLE');
  return { prize, description, title, footer, joinLabel, leaveLabel, winnerCount, durationMs, audience: fields.audience, color, image, thumbnail, channelId: String(fields.channelId), roleId };
}

function touch(record) { record.revision++; record.dirty = true; record.retryAt = 0; }
function recordIn(state, id, guildId) {
  const record = state.giveaways[id];
  if (!record || record.guildId !== guildId) throw sorteioError('NOT_FOUND');
  return record;
}

export function createSorteiosService({ store, now = Date.now, random = randomInt, canEnter, eligibleEntries, publish, findPublished, updateMessage, validateChannel, logger = console }) {
  const drawing = new Map();
  const syncing = new Map();
  let ticking = false;
  const draftIn = (state, id, ownerId, guildId) => {
    const draft = state.drafts[id];
    if (!draft || draft.ownerId !== ownerId || draft.guildId !== guildId || draft.expiresAt <= now()) throw sorteioError('DRAFT');
    return draft;
  };
  const service = {
    async createDraft({ guildId, ownerId, channelId, roleId = null, locale = 'pt' }) {
      return store.transaction(state => {
        for (const [id, draft] of Object.entries(state.drafts)) if (draft.expiresAt <= now()) delete state.drafts[id];
        if (Object.values(state.drafts).filter(draft => draft.ownerId === ownerId && draft.status === 'editing').length >= 10) throw sorteioError('DRAFT_LIMIT');
        const draft = { id: randomUUID(), guildId, ownerId, channelId, roleId, locale, prize: '', description: '', winnerCount: 1, durationMs: 86400000, audience: 'members', color: '#5865F2', image: '', status: 'editing', expiresAt: now() + SORTEIO_LIMITS.draftTtl };
        state.drafts[draft.id] = draft;
        return draft;
      });
    },
    async getDraft(id, ownerId, guildId) { return draftIn(await store.read(), id, ownerId, guildId); },
    async updateDraft(id, ownerId, guildId, patch) {
      return store.transaction(state => {
        const draft = draftIn(state, id, ownerId, guildId);
        if (draft.status !== 'editing') throw sorteioError('ALREADY_PUBLISHED');
        const next = validateSorteioFields({ ...draft, ...patch }, { allowEmptyPrize: true });
        Object.assign(draft, next, { expiresAt: now() + SORTEIO_LIMITS.draftTtl });
        return draft;
      });
    },
    async discardDraft(id, ownerId, guildId) {
      return store.transaction(state => {
        const draft = draftIn(state, id, ownerId, guildId);
        if (draft.status !== 'editing') throw sorteioError('ALREADY_PUBLISHED');
        delete state.drafts[id];
      });
    },
    async get(id, guildId) { return recordIn(await store.read(), id, guildId); },
    async list(guildId) { return Object.values((await store.read()).giveaways).filter(record => record.guildId === guildId).sort((a, b) => b.createdAt - a.createdAt); },
    async bindMessage(id, guildId, channelId, messageId) {
      return store.transaction(state => {
        const record = recordIn(state, id, guildId);
        if (record.channelId !== channelId || (record.messageId && record.messageId !== messageId)) throw sorteioError('MESSAGE');
        record.messageId = messageId;
        if (record.status === 'publishing') record.status = 'active';
        touch(record);
        return record;
      });
    },
    async publishDraft(id, ownerId, guildId) {
      const draft = await service.getDraft(id, ownerId, guildId);
      await validateChannel(draft);
      const reservation = await store.transaction(state => {
        const current = draftIn(state, id, ownerId, guildId);
        if (current.channelId !== draft.channelId) throw sorteioError('CHANNEL');
        if ((current.roleId || null) !== (draft.roleId || null)) throw sorteioError('ROLE');
        if (state.giveaways[id]) return { fresh: false, record: state.giveaways[id] };
        const fields = validateSorteioFields(current);
        if (Object.values(state.giveaways).filter(record => record.guildId === guildId && ['publishing', 'active', 'drawing'].includes(record.status)).length >= SORTEIO_LIMITS.maxActive) throw sorteioError('ACTIVE_LIMIT');
        const record = { ...fields, id, guildId, ownerId, locale: current.locale, createdAt: now(), endsAt: now() + fields.durationMs, status: 'publishing', messageId: null, entries: [], rounds: [], winners: [], revision: 1, dirty: true, retryAt: 0 };
        state.giveaways[id] = record; current.status = 'published';
        return { fresh: true, record };
      });
      if (!reservation.fresh) {
        if (reservation.record.status === 'cancelled') throw sorteioError('CLOSED');
        if (reservation.record.messageId) return reservation.record;
        const found = await findPublished(reservation.record);
        if (found) return service.bindMessage(id, guildId, draft.channelId, found.id);
        throw sorteioError('PUBLICATION_PENDING');
      }
      const message = await publish(reservation.record);
      return service.bindMessage(id, guildId, draft.channelId, message.id);
    },
    async join(id, guildId, userId) {
      const current = await service.get(id, guildId);
      if (current.status !== 'active' || current.endsAt <= now()) throw sorteioError('CLOSED');
      if (!await canEnter(current, userId)) throw sorteioError(current.audience === 'members' ? 'MEMBERS_ONLY' : 'SERVER_ONLY');
      return store.transaction(state => {
        const record = recordIn(state, id, guildId);
        if (record.status !== 'active' || record.endsAt <= now()) throw sorteioError('CLOSED');
        if (record.entries.includes(userId)) return { joined: false, count: record.entries.length };
        if (record.entries.length >= SORTEIO_LIMITS.maxEntries) throw sorteioError('ENTRY_LIMIT');
        record.entries.push(userId); touch(record);
        return { joined: true, count: record.entries.length };
      });
    },
    async leave(id, guildId, userId) {
      return store.transaction(state => {
        const record = recordIn(state, id, guildId);
        if (record.status !== 'active' || record.endsAt <= now()) throw sorteioError('CLOSED');
        const wasEntered = record.entries.includes(userId);
        record.entries = record.entries.filter(id => id !== userId);
        if (wasEntered) touch(record);
        return { left: wasEntered };
      });
    },
    async cancel(id, guildId) {
      return store.transaction(state => {
        const record = recordIn(state, id, guildId);
        if (!['publishing', 'active', 'drawing'].includes(record.status)) throw sorteioError('CLOSED');
        record.status = 'cancelled'; record.cancelledAt = now(); touch(record);
        return record;
      });
    },
    async draw(id, guildId, { manual = false, reroll = false } = {}) {
      if (drawing.has(id)) return drawing.get(id);
      const task = (async () => {
        const frozen = await store.transaction(state => {
          const record = recordIn(state, id, guildId);
          if (record.status !== 'drawing') {
            if (reroll ? record.status !== 'ended' : record.status !== 'active') throw sorteioError('CLOSED');
            if (!reroll && !manual && record.endsAt > now()) throw sorteioError('NOT_DUE');
            record.status = 'drawing'; record.drawToken = randomUUID(); touch(record);
          }
          return record;
        });
        try {
          const eligible = new Set(await eligibleEntries(frozen));
          const previous = new Set(frozen.rounds.flatMap(round => round.winners));
          const pool = [...new Set(frozen.entries)].filter(id => eligible.has(id) && !previous.has(id));
          const available = pool.length, count = Math.min(frozen.winnerCount, available);
          if (!available && frozen.rounds.length) {
            await store.transaction(state => {
              const record = recordIn(state, id, guildId);
              if (record.status === 'drawing' && record.drawToken === frozen.drawToken) {
                record.status = 'ended'; delete record.drawToken; touch(record);
              }
            });
            throw sorteioError('NO_ELIGIBLE');
          }
          for (let i = 0; i < count; i++) { const index = i + random(pool.length - i); [pool[i], pool[index]] = [pool[index], pool[i]]; }
          return await store.transaction(state => {
            const record = recordIn(state, id, guildId);
            if (record.status !== 'drawing' || record.drawToken !== frozen.drawToken) return record;
            record.winners = pool.slice(0, count);
            record.rounds.push({ number: record.rounds.length + 1, at: now(), eligibleCount: available, winners: [...record.winners] });
            record.status = 'ended'; record.drawnAt = now(); delete record.drawToken; touch(record);
            return record;
          });
        } catch (error) {
          await store.transaction(state => { const record = recordIn(state, id, guildId); if (record.status === 'drawing') record.retryAt = now() + 60000; });
          throw error;
        }
      })();
      drawing.set(id, task);
      try { return await task; } finally { drawing.delete(id); }
    },
    async sync(record) {
      const task = (syncing.get(record.id) || Promise.resolve()).catch(() => {}).then(async () => {
        const current = await service.get(record.id, record.guildId);
        if (!current.messageId || !current.dirty) return;
        await updateMessage(current);
        await store.transaction(state => { const latest = recordIn(state, record.id, record.guildId); latest.dirty = latest.revision !== current.revision; });
      });
      syncing.set(record.id, task);
      try { await task; } finally { if (syncing.get(record.id) === task) syncing.delete(record.id); }
    },
    async tick() {
      if (ticking) return;
      ticking = true;
      try {
        for (let record of Object.values((await store.read()).giveaways)) {
          if (record.retryAt > now()) continue;
          try {
            if (record.status === 'publishing') {
              const found = await findPublished(record);
              if (found) record = await service.bindMessage(record.id, record.guildId, record.channelId, found.id);
            }
            if (record.status === 'drawing' || (record.status === 'active' && record.endsAt <= now())) record = await service.draw(record.id, record.guildId);
            await service.sync(record);
          } catch (error) {
            logger.warn(`[GIVEAWAY] Retry pending for ${record.id}: ${error.sorteioCode || error.code || 'service-unavailable'}`);
            await store.transaction(state => { const latest = recordIn(state, record.id, record.guildId); latest.retryAt = now() + 60000; });
          }
        }
      } finally { ticking = false; }
    },
  };
  return service;
}
