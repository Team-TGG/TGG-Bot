import { getClient, formatDateTime, getMissionWeekStart } from './db.js';
import { SYSTEM_ROLES} from './discord.js';
import { fetchPlayerStats} from './brawlhalla.js';

/**
 * Puxa os guild points semanal da guilda
 */
export async function getGuildWeeklyGuildPoints() {
  const supabase = getClient();
  const weekStartDate = getMissionWeekStart();

  const { data, error } = await supabase
    .from('guild_weekly_guild_points')
    .select('total_guild_points')
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
 * Puxa os guild points semanal da guilda oponente no duelo semanal
 */
export async function getDuelGuildWeeklyGuildPoints() {
  const supabase = getClient();
  const weekStartDate = getMissionWeekStart();

  const { data, error } = await supabase
    .from('guild_duels')
    .select('guild_id, guild_points')
    .eq('week_start', weekStartDate)
    .limit(1);

  if (error) throw error;

  return data?.[0] || null;
}