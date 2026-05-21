import 'dotenv/config';
import 'win-ca';

if (process.env.IGNORE_SSL_ERRORS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { EmbedBuilder, Events } from 'discord.js';
import { createClient, runSync, runEloSync } from './src/discord.js';
import { syncNicknames, fetchBrawlhallaClanData } from './src/nicknameSync.js';
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig } from './config/index.js';
import { startCronJobs } from './src/scheduler/cron.js';
import { getUsers, getAllUsers, getUsersWithElo, getAllUsersWithElo } from './src/db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './utils/discordUtils.js';
import { checkChannelPermission } from './utils/permissions.js';

// Services
import { startInactiveReminder } from './src/services/inactivePlayers.js';
import { restoreMutes } from './src/services/muteManager.js';
// Commands
import { COMMAND_ALIASES, commands } from './src/commands.js';

async function main() {
  if (!discordConfig.token || !discordConfig.guildId) {
    console.error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env');
    process.exit(1);
  }

  const client = createClient();
  const PREFIX = '.';

  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

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

    // Verificação de rate limit para todos os comandos
    const now = Date.now();
    const userId = message.author.id;
    const lastCommand = rateLimitMap.get(userId);

    if (lastCommand && now - lastCommand < RATE_LIMIT_MS) {
      const remaining = Math.ceil((RATE_LIMIT_MS - (now - lastCommand)) / 1000);
      return await message.reply({
        embeds: [createErrorEmbed('Calma lá!', `Aguarde **${remaining}s** para usar outro comando.`)]
      }).catch(() => {});
    }

    rateLimitMap.set(userId, now);

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