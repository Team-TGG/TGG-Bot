
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

// Modo dev: sobe o bot sem nada que afete o servidor real — sem registrar slash
// commands, sem crons, sem lembrete de inativos, sem restaurar mutes/warns.
//
//   npm start      -> produção (a VM usa esse, nunca precisa de ajuste)
//   npm run dev    -> desenvolvimento
//
// Aceita a flag --dev ou BOT_MODE=dev no ambiente. Sem nenhum dos dois, é produção.
// Ver docs/modo-dev.md.
const devPorFlag = process.argv.includes('--dev');
const devPorEnv = (process.env.BOT_MODE || '').trim().toLowerCase() === 'dev';

export const runtime = {
  isDev: devPorFlag || devPorEnv,
  // Escotilha para testar comando novo: registra os slash commands mesmo em dev.
  // Em produção o registro acontece sempre.
  registerCommandsInDev:
    process.argv.includes('--register-commands') || process.env.DEV_REGISTER_COMMANDS === 'true',
};

export const discord = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
  applicationId: '1470608096056447006',
};

export const supabase = {
  url: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey: process.env.SUPABASE_ANON_KEY,
};

export const brawlhalla = {
  apiKey: process.env.BRAWLHALLA_API_KEY,
  clanId:'396943',
};

export const inactivePlayers = {
  inactiveRoleId: '1468593277363290304',
  channelId: '1468600851290521692',
  messageEnabled: true,
  messageInterval: process.env.INACTIVE_MESSAGE_INTERVAL,
};

export const tickets = {
  filaDeEsperaRoleId: '1466815420630565069',
  entrarNaGuildaChannelId: '1484570233124421692',
  filaGuildaChannelId: '1473760891676786801',
};

export const birthdays = {
  roleId: '1478478167961370845',
  channelId: '1437416350183325727',
};

export const tggCoinsEvents = {
  anunciosChannelId: '1437415122837573695', // Canal de anúncios
};

export const motd = {
  url: 'https://teamtgg.com.br/api/motd.php',
  channelId: '1437416481343406122', // Principal
};

// Vídeo explicativo da guilda (.video-guilda / .explicacao)
export const videoGuilda = {
  message: {
    channelId: '1448392117410857092',
    messageId: '1532359890855530626',
  },
};
