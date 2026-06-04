import 'dotenv/config';
import 'win-ca';

if (process.env.IGNORE_SSL_ERRORS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { EmbedBuilder, Events } from 'discord.js';
import { createClient, runSync, runEloSync } from './src/discord.js';
import { syncNicknames, fetchBrawlhallaClanData } from './src/nicknameSync.js';
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig, STAFF_ROLE_IDS } from './config/index.js';
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

  // Responde quem marcar o Topson em dias específicos
  const TOPSON_ID = '252249131202904074';
  const SUPORTE_CHANNEL_ID = '1461132037908856964';
  const TOPSON_MENTION_DAYS = [4, 6]; // Quinta (4) e Sábado (6) — UTC-3 BRT

  const TOPSON_MENTION_REGEX = new RegExp(`<@!?${TOPSON_ID}>`);

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const mentionsTopson = message.mentions.users.has(TOPSON_ID) || TOPSON_MENTION_REGEX.test(message.content);
    if (!mentionsTopson) return;

    const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
    if (!TOPSON_MENTION_DAYS.includes(now.getUTCDay())) return;

    await message.delete().catch(() => {});
    await message.channel.send(
      `ola ${message.author}! o jobson ta indisponivel no momento, mas vc pode falar com um helper ou staff, ou abrir um ticket em <#${SUPORTE_CHANNEL_ID}>`
    ).catch(() => {});
  });

  await client.login(discordConfig.token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});