
// deprecated
export const ALLOWED_USER_IDS = ['1447168951963353209', '252249131202904074', '1475984881640280126', '469616482721071134'];

// Staff Roles ID's
export const STAFF_ROLE_IDS = {
  helper: '1467177078204924168',
  moderator: '1461777581983535289',
  supervisor: '1437445763721592892',
  administrator: '1466951488730431518',
  viceLeader: '1465154307002470596',
  leader: '1437427830286717009',
}

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

export const birthdays = {
  roleId: '1478478167961370845',
  channelId: '1437416350183325727',
};