import 'dotenv/config';
import 'win-ca';

if (process.env.IGNORE_SSL_ERRORS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { EmbedBuilder, Events } from 'discord.js';
import { createClient, runSync, runEloSync } from './src/discord.js';
import { syncNicknames, fetchBrawlhallaClanData } from './src/nicknameSync.js';
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig, STAFF_ROLE_IDS, runtime } from './config/index.js';
import { startCronJobs } from './src/scheduler/cron.js';
import { getUsers, getAllUsers, getUsersWithElo, getAllUsersWithElo } from './src/db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './utils/discordUtils.js';
import { checkChannelPermission } from './utils/permissions.js';

// Services
import { startInactiveReminder } from './src/services/inactivePlayers.js';
import { restoreMutes } from './src/services/muteManager.js';
import { restoreTemporaryWarnings } from './src/services/warningManager.js';
// Commands
import { COMMAND_ALIASES, commands } from './src/commands.js';
// Slash
import { registerGuildCommands } from './src/slash/register.js';
import { registerInteractionHandler } from './src/interactions.js';

// Deixa explícito no boot o que aquele processo vai fazer. Em dev o risco é subir
// achando que está isolado e descobrir pelo ping dos inativos que não estava.
function logRuntimeMode(registrouSlash) {
  if (!runtime.isDev) {
    console.log('[MODE] PRODUCAO — slash commands, crons e lembrete de inativos ATIVOS');
    return;
  }

  const linha = '='.repeat(60);
  console.log(`\n${linha}`);
  console.log('  MODO DEV — nada que afete o servidor real vai rodar');
  console.log(linha);
  console.log('  pulado : lembrete de inativos (ping no canal + DM)');
  console.log('  pulado : crons (cargos, ELO, apelidos, aniversarios, MOTD)');
  console.log('  pulado : restauracao de mutes e warns temporarios');
  console.log(`  ${registrouSlash ? 'ATIVO  : registro de slash commands (--register-commands)' : 'pulado : registro de slash commands'}`);
  console.log('  ativo  : comandos por prefixo e slash ja registrados na guilda');
  console.log(`${linha}\n`);
}

async function main() {
  if (!discordConfig.token || !discordConfig.guildId) {
    console.error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env');
    process.exit(1);
  }

  const client = createClient();
  const PREFIX = '.';

  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // O PUT reescreve os slash commands da guilda — em dev só com --register-commands
    const vaiRegistrarSlash = !runtime.isDev || runtime.registerCommandsInDev;
    logRuntimeMode(vaiRegistrarSlash);

    if (vaiRegistrarSlash) {
      try {
        await registerGuildCommands();
      } catch (err) {
        console.error('[Slash Register]', err);
      }
    }

    // Listener interactionCreate (router slash; botões/menus continuam via collectors).
    // Vale nos dois modos: é assim que os slash já registrados chegam aos handlers.
    registerInteractionHandler(client);

    // Daqui pra baixo é tudo efeito no servidor real: cron mexe em cargo e apelido,
    // o lembrete pinga e manda DM, e restaurar mutes/warns reagenda expiracoes.
    if (runtime.isDev) return;

    startCronJobs(client, {
      fetchBrawlhallaClanData,
      runSync,
      runEloSync,
      syncNicknames,
      getUsers,
      getUsersWithElo,
      getAllUsers,
      getAllUsersWithElo
    }); // Iniciar crons

    // Aviso de inatividade e restauração de mutes
    startInactiveReminder(client);
    await restoreMutes(client);
    await restoreTemporaryWarnings(client);
  });

  // Armazenamento de rate limit
  const rateLimitMap = new Map();
  const RATE_LIMIT_MS = 5000; // 5 segundos

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const content = message.content.slice(PREFIX.length).trim();
    if (!content) return;

    const args = content.split(/\s+/);
    const rawCommand = args.shift().toLowerCase();
    const command = COMMAND_ALIASES[rawCommand];

    if (!command) return;

    // Verificar permissão de canal antes de processar o comando
    const allowed = await checkChannelPermission(message);
    if (!allowed) return;

    // Verifica se usuário possui cargo helper+
    const isStaff = message.member?.roles?.cache?.some(
      role => Object.values(STAFF_ROLE_IDS).includes(role.id)
    );

    // Verificação de rate limit para todos os comandos
    const now = Date.now();
    const userId = message.author.id;

    // Staffs estão isentos do rate limit
    if (!isStaff) {
      const lastCommand = rateLimitMap.get(userId);
      
      if (lastCommand && now - lastCommand < RATE_LIMIT_MS) {
        const remaining = Math.ceil((RATE_LIMIT_MS - (now - lastCommand)) / 1000);
        return await message.reply({
          embeds: [createErrorEmbed('Calma lá!', `Aguarde **${remaining}s** para usar outro comando.`)]
        }).catch(() => {});
      }
      
      rateLimitMap.set(userId, now);
    }

    const cmd = commands[command];
    if (!cmd) return;

    try {
      await cmd(message, args, client);
    } catch (err) {
      console.error('[Command Error]', err);
      await message.reply({
        embeds: [createErrorEmbed('Erro Interno', `Um erro inesperado ocorreu: ${err.message}`)]
      }).catch(() => {});
    }
  });

  await client.login(discordConfig.token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
