/**
 * Central config from environment variables.
 * Replace placeholder values with your real credentials.
 */

/** Only these Discord user IDs can run sync slash commands */
export const ALLOWED_USER_IDS = ['1447168951963353209', '252249131202904074'];

export const discord = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
};

export const supabase = {
  url: process.env.SUPABASE_URL,
  /** Use service_role key for server-side (bypasses RLS); or anon if your RLS allows reading users */
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey: process.env.SUPABASE_ANON_KEY,
};

/** Guild Activity API (fetch latest guild report from guild-report.php) */
export const guildActivity = {
  /** Base API URL */
  baseUrl: process.env.TGG_API_URL,
  /** Guild Report endpoint */
  endpoint: process.env.TGG_GUILD_REPORT_ENDPOINT || '/TGG/api/guild-report.php',
  /** Bearer token for authentication */
  apiKey: process.env.TGG_API_KEY,
  /** Discord channel ID where to post embeds */
  channelId: process.env.GUILD_ACTIVITY_CHANNEL_ID || null,
};

/** Guild Movimentacao API (fetch movement logs with date range) */
export const movimentacao = {
  /** Base API URL */
  baseUrl: process.env.TGG_API_URL,
  /** Movimentacao endpoint */
  endpoint: process.env.TGG_MOVIMENTACAO_ENDPOINT || '/TGG/api/guild-movimentacao.php',
  /** Bearer token for authentication */
  apiKey: process.env.TGG_API_KEY,
};

/** Brawlhalla API configuration */
export const brawlhalla = {
  apiKey: process.env.BRAWLHALLA_API_KEY,
  /** Clan ID to sync nicknames with */
  clanId: process.env.BRAWLHALLA_CLAN_ID || '396943',
};
