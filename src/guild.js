import { getClient, formatDateTime, getMissionWeekStart } from './db.js';
import { SYSTEM_ROLES} from './discord.js';
import { fetchPlayerStats} from './brawlhalla.js';

/**
 * Puxa os guild points semanal da guilda
 */
export async function getGuildWeeklyGuildPoints() {
  const supabase = getClient();
  const weekStartDate = getMissionWeekStart();

  // `*` e não a lista de colunas: `total_xp` é coluna nova, e nomear uma coluna que ainda não
  // existe é erro 42703 — o .duel inteiro cairia num banco não migrado, em vez de só ficar sem o XP.
  const { data, error } = await supabase
    .from('guild_weekly_guild_points')
    .select('*')
    .eq('created_at', weekStartDate)
    .limit(1);

  if (error) throw error;

  return data?.[0] || null;
}

/**
 * Retorna os Guild Points do início da semana para um jogador específico. Se o jogador não tiver pontos, retorna false.
 */
export async function getPlayerWeeklyGuildPoints(brawlhallaId) {
  const supabase = getClient();

  const weekStartDate = getMissionWeekStart();

  const { data, error } = await supabase
    .from('player_weekly_info')
    .select('guild_points')
    .eq('week_start', weekStartDate)
    .eq('brawlhalla_id', brawlhallaId)
    .limit(1);

  if (error) throw error;

  const guildPoints = Number(data?.[0]?.guild_points || 0);

  if (guildPoints === 0) {
    return false;
  }

  return guildPoints;
}

/**
 * Guildas monitoradas para achar o oponente do duelo.
 *
 * A API não tem ranking de guildas e o espaço de guild_id é esparso demais para varrer, então o
 * plantel do topo é mantido à mão nessa tabela. O `rank` de /v1/guild/stats é a posição corrente
 * (não o acumulado), então basta ler o rank de cada uma para saber quem está no lugar do par.
 */
export async function getGuildRegistry() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('guild_registry')
    .select('guild_id');

  if (error) throw error;

  return (data ?? []).map(row => String(row.guild_id));
}

/**
 * Linha de base já gravada para a semana informada (ou null).
 * Em guild_weekly_guild_points o `created_at` guarda o início da semana, não o instante do insert.
 */
export async function getGuildWeeklyPointsByWeek(weekStart) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('guild_weekly_guild_points')
    .select('*')
    .eq('created_at', weekStart)
    .limit(1);

  if (error) throw error;

  return data?.[0] || null;
}

export async function getGuildDuelByWeek(weekStart) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('guild_duels')
    .select('*')
    .eq('week_start', weekStart)
    .limit(1);

  if (error) throw error;

  return data?.[0] || null;
}

/**
 * Guild points e XP entram juntos porque saem da mesma leitura, na quinta 06:00 (ver
 * guildDuelService.js). XP ausente na API fica **nulo, nunca 0**: o ganho da semana é diferença
 * contra esta linha, e 0 faria a leitura seguinte contar o acumulado inteiro como ganho.
 *
 * Quem protege a linha é o `insert` — só é chamado quando a semana ainda não existe, nunca
 * `upsert`, do mesmo jeito que `ensurePlayerWeeklyInfo` faz com a linha do jogador.
 */
export async function saveGuildWeeklyPoints(weekStart, totalGuildPoints, totalXp = null) {
  const supabase = getClient();

  const { error } = await supabase
    .from('guild_weekly_guild_points')
    .insert({
      created_at: weekStart,
      total_guild_points: Number(totalGuildPoints),
      total_xp: totalXp == null ? null : Number(totalXp),
    });

  if (error) throw error;
}

export async function saveGuildDuel(weekStart, guildId, guildPoints, xp = null) {
  const supabase = getClient();

  const { error } = await supabase
    .from('guild_duels')
    .insert({
      week_start: weekStart,
      guild_id: String(guildId),
      guild_points: Number(guildPoints),
      xp: xp == null ? null : Number(xp),
    });

  if (error) throw error;
}

/**
 * Puxa os guild points semanal da guilda oponente no duelo semanal
 */
export async function getDuelGuildWeeklyGuildPoints() {
  const supabase = getClient();
  const weekStartDate = getMissionWeekStart();

  const { data, error } = await supabase
    .from('guild_duels')
    .select('*')
    .eq('week_start', weekStartDate)
    .limit(1);

  if (error) throw error;

  return data?.[0] || null;
}