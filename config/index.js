// adm user ids
const ENABLE_INACTIVE_REMINDER = false;

export const discord = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
};

export const supabase = {
  url: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey: process.env.SUPABASE_ANON_KEY,
};


export const guildActivity = {
  baseUrl: process.env.TGG_API_URL,
  endpoint: '/TGG/api/guild-report.php',
  apiKey: process.env.TGG_API_KEY,
  channelId: ''|| null,
};

export const movimentacao = {
  baseUrl: process.env.TGG_API_URL,
  endpoint: '/TGG/api/guild-movimentacao.php',
  apiKey: process.env.TGG_API_KEY,
};

export const brawlhalla = {
  apiKey: process.env.BRAWLHALLA_API_KEY,
  clanId:'396943',
};
export const inactivePlayers = {
  inactiveRoleId: '1468593277363290304',
  channelId: '1468600851290521692',
  messageInterval: process.env.INACTIVE_MESSAGE_INTERVAL,
};