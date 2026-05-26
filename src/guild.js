import { getClient, formatDateTime } from './db.js';
import { SYSTEM_ROLES} from './discord.js';
import { fetchPlayerStats} from './brawlhalla.js';

/**
 * Puxa os guild points semanal da guilda
 */
export async function getGuildWeeklyGuildPoints(weekEndDate) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('guild_weekly_guild_points')
    .select('total_guild_points')
    .eq('created_at', weekEndDate)
    .limit(1);

  if (error) throw error;

  return data?.[0] || null;
}