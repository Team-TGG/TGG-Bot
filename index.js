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
import { getUsers, getUsersWithElo } from './src/db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './utils/discordUtils.js';
import { checkChannelPermission } from './utils/permissions.js';

// Services
import { startInactiveReminder } from './src/services/inactivePlayers.js';
import { restoreMutes } from './src/services/muteManager.js';

// Handlers
import { handleSync, handleSyncNick, handleRefreshCache, handleWarn, handleUnwarn, handleWarns, handleMute, handleUnmute, handleBan, handleInacAll, handleInacList, handleConcluida, handleCadastrarMissao, handleEntrou } from './src/admin.js';
import { handleHelp, handleStats, handleClan, handleActive, handleRegras, handleMissoes, handleMotd } from './src/public.js';
import { handleDaily, handleBalance, handleHistorico, handleLeaderboard, handleShop, handleBuy, handleAddProvider, handleRemoveProvider, handleConquistas, handleStreak, handleAddCoins } from './src/tggCoinsCommands.js';

async function main() {
  if (!discordConfig.token || !discordConfig.guildId) {
    console.error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env');
    process.exit(1);
  }

  const client = createClient();
  const PREFIX = '.';

  // Command Alises
  const COMMAND_ALIASES = {
    'help': 'help',
    'ajuda': 'help',
    'comandos': 'help',
    'regras': 'regras',
    'rules': 'regras',
    'reguas': 'regras',
    'legolas': 'regras',
    'stats': 'stats',
    'status': 'stats',
    'estatisticas': 'stats',
    'clan': 'clan',
    'clã': 'clan',
    'missoes': 'missoes',
    'missões': 'missoes',
    'missao': 'missoes',
    'missão': 'missoes',
    'missions': 'missoes',
    'active': 'active',
    'sync': 'sync',
    'sync-guild': 'sync',
    'sync-roles': 'sync',
    'sync-elo': 'sync',
    'sync-nick': 'sync-nick',
    'sync-nicknames': 'sync-nick',
    'refresh-cache': 'refresh-cache',
    'warn': 'warn',
    'unwarn': 'unwarn',
    'warns': 'warns',
    'warnings': 'warns',
    'mute': 'mute',
    'unmute': 'unmute',
    'ban': 'ban',
    'inac-all': 'inac-all',
    'inac-list': 'inac-list',
    'concluida': 'concluida',
    'concluída': 'concluida',
    'concluido': 'concluida',
    'concluído': 'concluida',
    'comcluido': 'concluida', // Becca
    'cadastrarmissao': 'cadastrarmissao',
    'cadastrarmissão': 'cadastrarmissao',
    'entrou': 'entrou',
    'daily': 'daily',
    'diario': 'daily',
    'diaria': 'daily',
    'diária': 'daily',
    'diário': 'daily',
    'deili': 'daily', // CrZ
    'balance': 'balance',
    'bal': 'balance',
    'coins': 'balance',
    'moedas': 'balance',
    'saldo  ': 'balance',
    'historico': 'historico',
    'histórico': 'historico',
    'hist': 'historico',
    'leaderboard': 'leaderboard',
    'lb': 'leaderboard',
    'shop': 'shop',
    'loja': 'shop',
    'buy': 'buy',
    'comprar': 'buy',
    'conquistas': 'conquistas',
    'conquista': 'conquistas',
    'achievements': 'conquistas',
    'achievement': 'conquistas',
    'streak': 'streak',
    'sequencia': 'streak',
    'sequência': 'streak',
    'motd': 'motd',
    'addprovider': 'addprovider',
    'removeprovider': 'removeprovider',
    'addcoins': 'addcoins',
  };

  // Lista de comandos
  const commands = {
    // Públicos
    help: handleHelp,
    regras: handleRegras,
    motd: handleMotd,
    stats: handleStats,
    clan: handleClan,
    missoes: handleMissoes,
    active: handleActive,

    // Admin
    sync: handleSync,
    'sync-nick': handleSyncNick,
    'refresh-cache': handleRefreshCache,
    warn: handleWarn,
    unwarn: handleUnwarn,
    warns: handleWarns,
    mute: handleMute,
    unmute: handleUnmute,
    ban: handleBan,
    'inac-all': handleInacAll,
    'inac-list': handleInacList,
    concluida: handleConcluida,
    cadastrarmissao: handleCadastrarMissao,
    entrou: handleEntrou,

    // TGG-Coins
    daily: handleDaily,
    balance: handleBalance,
    historico: handleHistorico,
    leaderboard: handleLeaderboard,
    shop: handleShop,
    buy: handleBuy,
    conquistas: handleConquistas,
    streak: handleStreak,
    addprovider: handleAddProvider,
    removeprovider: handleRemoveProvider,
    addcoins: handleAddCoins
  };

  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    startCronJobs(client, {
      fetchBrawlhallaClanData,
      runSync,
      runEloSync,
      syncNicknames,
      getUsers,
      getUsersWithElo
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

    // Verificar permissão de canal antes de processar o comando
    const allowed = await checkChannelPermission(message);
    if (!allowed) return;

    const content = message.content.slice(PREFIX.length).trim();
    if (!content) return;

    const args = content.split(/\s+/);
    const rawCommand = args.shift().toLowerCase();
    const command = COMMAND_ALIASES[rawCommand];

    if (!command) return;

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