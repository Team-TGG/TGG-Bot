import { pontosSemanaisDaGuilda, pontosValidos } from './pontosDaGuilda.js';

function numberOrNull(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const read = async (fn, id) => {
  try { return { data: await fn(id), error: null }; }
  catch (error) { return { data: null, error }; }
};

function missingPoints() {
  const error = new Error('Os pontos de guilda estão indisponíveis no momento.');
  error.guildPointsUnavailable = true;
  error.apiVersion = 'v1';
  return error;
}

/** Adaptadores legados ficam nas bordas; comandos e regras recebem os mesmos campos. */
export function createBrawlhallaService({ legacyGuild, guild, members, playerStats, playerGuild, cachedGuild = () => null, cachedLegacyGuild = () => null, ownGuildId, normalizeName = String, optionalTimeoutMs = 6000 }) {
  function legacyMatches(data, id) {
    return String(data?.clan_id) === String(id) && Array.isArray(data?.clan);
  }

  function normalizeGuild(primary, legacy, id) {
    const points = pontosSemanaisDaGuilda(primary?.guild_points);
    const xp = numberOrNull(primary?.xp);
    const legacyXp = numberOrNull(primary?.legacy_xp);
    const usesLegacy = Boolean(legacy && (!primary || !primary.name || primary.member_count == null || primary.create_date == null || xp == null || legacyXp == null));
    return {
      guild_id: String(id),
      name: normalizeName(primary?.name || legacy?.clan_name || `Guilda ${id}`),
      create_date: numberOrNull(primary?.create_date ?? legacy?.clan_create_date),
      member_count: numberOrNull(primary?.member_count) ?? legacy?.clan.length ?? null,
      rank: numberOrNull(primary?.rank),
      xp,
      legacy_xp: legacyXp,
      xp_total: xp != null && legacyXp != null ? xp + legacyXp : numberOrNull(legacy?.clan_lifetime_xp ?? legacy?.clan_xp),
      guild_points: points,
      notice: primary?.notice ?? null,
      discord_invite_code: primary?.discord_invite_code ?? null,
      tags: Array.isArray(primary?.tags) ? primary.tags : [],
      is_recruiting: typeof primary?.is_recruiting === 'boolean' ? primary.is_recruiting : null,
      apiSource: primary ? usesLegacy ? 'mixed' : 'v1' : 'v0',
      sources: { metadata: primary ? usesLegacy ? 'mixed' : 'v1' : 'v0', guildPoints: points == null ? null : 'v1' },
      availability: { guildPoints: points != null },
    };
  }

  function getCachedGuild(id) {
    const primary = cachedGuild(id);
    if (String(primary?.guild_id) !== String(id) || pontosSemanaisDaGuilda(primary?.guild_points) == null) return null;
    const legacy = cachedLegacyGuild(id);
    return normalizeGuild(primary, legacyMatches(legacy, id) ? legacy : null, id);
  }

  async function getGuild(id, { requireGuildPoints = true } = {}) {
    const primary = await read(guild, id);
    if (primary.data && (String(primary.data.guild_id) !== String(id) || pontosSemanaisDaGuilda(primary.data.guild_points) == null)) {
      primary.data = null;
      primary.error = missingPoints();
    }
    if (!primary.data && requireGuildPoints) throw primary.error || missingPoints();
    let legacy = null;
    const p = primary.data;
    if (!p || !p.name || p.member_count == null || p.create_date == null || p.xp == null || p.legacy_xp == null) {
      const fallback = await read(legacyGuild, id);
      if (legacyMatches(fallback.data, id)) legacy = fallback.data;
      if (!p && !legacy) throw primary.error || fallback.error || new Error('Dados da guilda indisponíveis.');
    }
    return normalizeGuild(p, legacy, id);
  }

  async function getMembers(id = ownGuildId, { requireGuildPoints = true } = {}) {
    const [primary, fallback] = await Promise.all([read(members, id), read(legacyGuild, id)]);
    let p = String(primary.data?.guild_id) === String(id) && Array.isArray(primary.data?.guild_members) ? primary.data : null;
    const legacy = legacyMatches(fallback.data, id) ? fallback.data : null;
    if (p && !p.guild_members.length && legacy?.clan.length) {
      p = null;
      primary.error = missingPoints();
    }
    if (!p && requireGuildPoints) throw primary.error || missingPoints();
    if (!p && !legacy) throw primary.error || fallback.error || new Error('Membros da guilda indisponíveis.');
    const byId = new Map((legacy?.clan ?? []).map(member => [String(member.brawlhalla_id), member]));
    // A lista v1 continua sendo a referência quando disponível; a antiga só completa metadados pelo ID.
    const roster = p?.guild_members ?? legacy.clan;
    let enriched = false;
    const result = roster.map(member => {
      const older = byId.get(String(member.brawlhalla_id));
      if (p && older && (!member.name || member.rank == null || member.join_date == null || member.xp == null)) enriched = true;
      return {
        brawlhalla_id: String(member.brawlhalla_id),
        name: normalizeName(member.name || older?.name || 'Desconhecido'),
        rank: member.rank ?? older?.rank ?? null,
        join_date: numberOrNull(member.join_date ?? older?.join_date),
        xp: numberOrNull(member.xp ?? older?.xp),
        guild_points: p ? pontosValidos(member.guild_points) : null,
      };
    });
    const pointsAvailable = Boolean(p && (!result.length || result.some(member => member.guild_points != null)));
    if (requireGuildPoints && !pointsAvailable) throw missingPoints();
    return {
      guild_id: String(id), guild_members: result,
      apiSource: p ? enriched ? 'mixed' : 'v1' : 'v0',
      sources: { metadata: p ? enriched ? 'mixed' : 'v1' : 'v0', guildPoints: p ? 'v1' : null },
      availability: { guildPoints: pointsAvailable },
    };
  }

  async function getPlayerGuild(id) {
    const individual = await read(playerGuild, id);
    if (String(individual.data?.brawlhalla_id) === String(id) && individual.data?.guild_id != null && pontosValidos(individual.data.personal_points) != null) {
      const data = individual.data;
      return {
        brawlhalla_id: String(id), guild_id: String(data.guild_id), guild_name: data.guild_name ?? null,
        personal_points: pontosValidos(data.personal_points), personal_xp: numberOrNull(data.personal_xp),
        personal_xp_this_week: numberOrNull(data.personal_xp_this_week),
        join_date: numberOrNull(data.join_date), rank: data.rank ?? null, apiSource: 'v1',
      };
    }
    // A rota em lote pode continuar respondendo quando a individual falha.
    const batch = await read(() => getMembers(ownGuildId), ownGuildId);
    const member = batch.data?.guild_members.find(row => String(row.brawlhalla_id) === String(id));
    if (member?.guild_points != null) return {
      brawlhalla_id: String(id), guild_id: String(ownGuildId), guild_name: null,
      personal_points: member.guild_points, personal_xp: member.xp,
      personal_xp_this_week: null, join_date: member.join_date, rank: member.rank, apiSource: 'v1-batch',
    };
    throw individual.error || batch.error || missingPoints();
  }

  async function getPlayerProfile(id) {
    let timer;
    const points = Promise.race([
      read(getPlayerGuild, id),
      new Promise(resolve => { timer = setTimeout(() => resolve({ data: null }), optionalTimeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    const [stats, guildData] = await Promise.all([playerStats(id), points]);
    const value = pontosValidos(guildData.data?.personal_points);
    return {
      ...stats,
      guildAccountId: String(id), guildPoints: value,
      sources: { stats: 'v0', ranked: 'v0', guildPoints: value == null ? null : 'v1' },
      availability: { guildPoints: value != null },
    };
  }

  return { getGuild, getCachedGuild, getMembers, getPlayerGuild, getPlayerProfile };
}
