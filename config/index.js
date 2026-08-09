
// deprecated
export const ALLOWED_USER_IDS = ['1447168951963353209', '252249131202904074', '1475984881640280126', '469616482721071134'];

// Staff Roles ID's
export const STAFF_ROLE_IDS = {
  assistant: '1514285348971085864', // mesmo nível do helper
  helper: '1467177078204924168',
  moderator: '1461777581983535289',
  supervisor: '1437445763721592892',
  administrator: '1466951488730431518',
  viceLeader: '1465154307002470596',
  leader: '1437427830286717009',
}

// Modo dev: sobe o bot sem nada que afete o servidor real - sem registrar slash
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

// Pedidos de blindagem do `.justificativa`: onde a staff aprova ou recusa
// (ver src/services/weeklyInactiveService.js e o roteamento em src/interactions.js).
export const justificativas = {
  channelId: '1448392117410857092', // canal de helper
};

// Lembrete de domingo 12:00 para quem ainda não bateu a contribuição mínima
// (ver src/services/contributionReminderService.js). A semana só fecha na quarta 06:00, mas
// domingo ainda dá tempo de correr atrás. Sem channelId o lembrete é pulado inteiro.
export const contributionReminder = {
  channelId: '1440865671150829648', // tgg-geral
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

// Cadastro automático das missões, toda quinta 06:00 (ver src/services/weeklyMissionsService.js).
// Sem channelId as missões continuam sendo cadastradas - só o anúncio é pulado.
export const weeklyMissions = {
  channelId: '1448392117410857092', // canal de helper
  correcaoUrl: 'https://teamtgg.com.br/cadastro_usuario', // onde corrigir divergência
};

// MVP da semana, trocado sozinho na quarta 06:00 (ver src/services/weeklyMvpService.js).
// `limite` são as vagas de contagem: officers/admins e o líder recebem o cargo enquanto a
// contagem corre, mas não ocupam vaga. Sem channelId o cargo continua sendo trocado - só o
// anúncio é pulado.
export const weeklyMvp = {
  roleId: '1448466041997889769',
  channelId: '1448392117410857092', // canal de helper
  limite: 14,
};

// Duelo semanal de guildas, cadastrado sozinho na quarta 07:00 (ver src/services/guildDuelService.js).
export const guildDuel = {
  ourGuildId: '396943',
  channelId: '1448392117410857092', // canal de helper
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
