/** Nomes de jogo podem ter acentos, espaços, tags e letras Unicode estilizadas. */
export function normalizePlayerName(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function playerId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0 ? String(Number(text)) : null;
}

function matchingPlayers(players, name) {
  const query = normalizePlayerName(name);
  const unique = new Map();
  for (const player of players ?? []) {
    const id = playerId(player.brawlhalla_id);
    if (id && normalizePlayerName(player.name).includes(query)) unique.set(id, { id, name: String(player.name) });
  }
  const matches = [...unique.values()];
  const exact = matches.filter(player => normalizePlayerName(player.name) === query);
  return exact.length ? exact : matches;
}

/** Resolve o alvo antes de buscar estatísticas; nunca escolhe a primeira conta de uma busca ambígua. */
export function createPlayerLookup({ getMembers, searchPlayers, getUser, getStats }) {
  return async function lookup({ nome, brawlhalla_id } = {}, context = {}) {
    const query = String(nome ?? '').trim();
    const self = !query || /^(eu|mim|meu|minha|me|eu mesmo|eu mesma)$/i.test(query);
    let id;
    let candidates;
    let source;
    if (context.membroDiscordId || (!brawlhalla_id && self)) {
      const target = context.membroDiscordId || context.discordId;
      const user = target ? await getUser(String(target)) : null;
      id = playerId(user?.brawlhalla_id);
      if (!id) return { status: 'unregistered', self: !context.membroDiscordId || String(target) === String(context.discordId) };
      source = 'cadastro do bot';
    } else if (brawlhalla_id != null) {
      id = playerId(brawlhalla_id);
      if (!id) return { status: 'invalid-id' };
      source = 'ID informado';
    } else {
      if (normalizePlayerName(query).length < 2 || query.length > 100) return { status: 'invalid-name' };
      // A lista da guilda identifica o apelido mesmo quando o jogador não está no ranking 1v1.
      candidates = matchingPlayers(await getMembers().catch(() => []), query);
      source = 'membros da guilda';
      if (!candidates.length) {
        const page = await searchPlayers(query);
        candidates = matchingPlayers(page, query);
        source = 'busca pública do ranking 1v1';
        // Uma página cheia pode esconder homônimos; um ID é necessário para garantir a conta.
        if (page.length >= 50 && candidates.length) return { status: 'ambiguous', query, source, candidates, incomplete: true };
      }
      if (!candidates.length) return { status: 'not-found', query, source };
      if (candidates.length > 1) return { status: 'ambiguous', query, source, candidates };
      id = candidates[0].id;
    }
    let stats;
    try { stats = await getStats(id); }
    catch (error) {
      if (error.status === 404) return { status: 'not-found', query, source };
      throw error;
    }
    if (!stats?.name || playerId(stats.brawlhalla_id) !== id) {
      const error = new Error('A API não retornou um perfil válido para essa conta.');
      error.apiForaDoAr = true;
      throw error;
    }
    return { status: 'found', query, source, stats, self: source === 'cadastro do bot' && (!context.membroDiscordId || String(context.membroDiscordId) === String(context.discordId)) };
  };
}
