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
import { getUsers, getUsersWithElo, getUserByDiscordId, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, getClient, reactivateOrAddUser, addPersistentMute, removePersistentMute, getActiveMutes, getMissionWeekStart, getActiveUser } from './src/db.js';
import { safeSetTimeout } from './src/moderation.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './utils/discordUtils.js';

// Handlers
import { handleSync, handleSyncNick, handleRefreshCache, handleWarn, handleUnwarn, handleWarns, handleMute, handleUnmute, handleBan, handleInacAll, handleInacList, handleConcluida, handleCadastrarMissao, handleEntrou } from './src/admin.js';
import { handleHelp, handleStats, handleClan, handleActive, handleRegras, handleMissoes } from './src/public.js';
import { handleDaily, handleBalance, handleHistorico, handleLeaderboard, handleShop, handleBuy } from './src/tggCoinsCommands.js';

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
    'regras': 'regras',
    'rules': 'regras',
    'stats': 'stats',
    'estatisticas': 'stats',
    'clan': 'clan',
    'clã': 'clan',
    'missoes': 'missoes',
    'missões': 'missoes',
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
    'balance': 'balance',
    'bal': 'balance',
    'coins': 'balance',
    'historico': 'historico',
    'histórico': 'historico',
    'leaderboard': 'leaderboard',
    'lb': 'leaderboard',
    'shop': 'shop',
    'loja': 'shop',
    'buy': 'buy',
    'comprar': 'buy',
  };

  // Lista de comandos
  const commands = {
    // Públicos
    help: handleHelp,
    regras: handleRegras,
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
    buy: handleBuy
  };

  client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);

    startCronJobs(client, {
      fetchBrawlhallaClanData,
      runSync,
      runEloSync,
      syncNicknames,
      getUsers,
      getUsersWithElo
    }); // Iniciar crons
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const content = message.content.slice(PREFIX.length).trim();
    if (!content) return;

    const args = content.split(/\s+/);
    const rawCommand = args.shift().toLowerCase();
    const command = COMMAND_ALIASES[rawCommand];

    if (!command) return;

    const cmd = commands[command];
    if (!cmd) return;

    try {
      await cmd(message, args, client);
    } catch (err) {
      console.error('[Command Error]', err);
      await message.reply({ 
        embeds: 
          [createErrorEmbed('Erro Interno', `Um erro inesperado ocorreu: ${err.message}`)] })
        .catch(() => { }
      );
    }
  });

  // task com periodo
  async function sendInactivePlayersReminder() {
    try {
      const channelId = inactivePlayersConfig.channelId;
      if (!channelId) {
        console.log('[Inactive Reminder] INACTIVE_PLAYERS_CHANNEL_ID not configured, skipping');
        return;
      }

      const channel = client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`[Inactive Reminder] Channel ${channelId} not found`);
        return;
      }

      const inactivePlayers = await getInactivePlayers();

      if (inactivePlayers.length === 0) {
        console.log('[Inactive Reminder] No inactive players');
        return;
      }

      const mentions = inactivePlayers
        .filter(p => p.discord_id)
        .map(p => `<@${p.discord_id}>`)
        .join(' ');

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle('⚠️ Lembrete: Usuários Inativos')
        .setDescription(`Olá! Vocês estão marcados como inativos
          Se você está nesta lista, significa que fez menos de 1000 de contribuição na semana passada. 
          Para saber como contribuir, veja o canal <#${'1480627066792579072'}> ou fale com um membro da staff.
          Para mostrar que está ativo, use o comando \`.active\` com uma justificativa para se remover da lista.
          Ex: \`.active Estava viajando e não consegui jogar.\``)
        .setTimestamp();

      await channel.send({
        content: mentions, // Mencionar os players fora do embed pra pingar
        embeds: [embed],
        allowedMentions: {
          users: inactivePlayers
            .filter(p => p.discord_id)
            .map(p => p.discord_id),
        }
      });

      // DM
      const dmEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('⚠️ Aviso de Inatividade')
        .setDescription(`Você está inativo. Para mostrar que está ativo, use o comando \`.active <justificativa>\` no canal <#1468600851290521692>.`)
        .setTimestamp();

      for (const player of inactivePlayers) {
        if (!player.discord_id) continue;
        try {
          const user = await client.users.fetch(player.discord_id).catch(() => null);
          if (user) {
            await user.send({ embeds: [dmEmbed] }).catch(() => {
              console.log(`[Inactive Reminder] Could not send DM to ${player.discord_id}`);
            });
          }
        } catch (err) {
          console.log(`[Inactive Reminder] Failed to DM ${player.discord_id}: ${err.message}`);
        }
      }

      console.log(`[Inactive Reminder] Sent message and DMs with ${inactivePlayers.length} inactive players`);
    } catch (err) {
      console.error('[Inactive Reminder Error]', err);
    }
  }

  // Configuração do lembrete periódico
  if (inactivePlayersConfig.channelId) {
    const interval = parseInt(inactivePlayersConfig.messageInterval) || 10800000; // 3 hours default
    console.log(`[Scheduled] Inactive players reminder will run every ${interval}ms (${(interval / 1000 / 60 / 60 / 24).toFixed(1)} days)`);
    setInterval(sendInactivePlayersReminder, interval);
    setTimeout(sendInactivePlayersReminder, 5000);
  }

  // Inicializar mutes ativos
  client.once(Events.ClientReady, async () => {
    try {
      const activeMutes = await getActiveMutes();
      console.log(`[Boot] Restoring ${activeMutes.length} active mutes...`);

      const guild = client.guilds.cache.get(discordConfig.guildId);
      if (!guild) return;

      let muteRole = guild.roles.cache.find(r => r.name === 'Muted');

      for (const mute of activeMutes) {
        const remainingMs = new Date(mute.expires_at) - new Date();
        if (remainingMs <= 0) {
          await removePersistentMute(mute.user_id);
          const member = await guild.members.fetch(mute.user_id).catch(() => null);
          if (member && muteRole) {
            await member.roles.remove(muteRole).catch(() => { });
          }
          continue;
        }

        safeSetTimeout(async () => {
          const m = await guild.members.fetch(mute.user_id).catch(() => null);
          if (m && muteRole && m.roles.cache.has(muteRole.id)) {
            await m.roles.remove(muteRole).catch(() => { });
            if (m.voice.serverMute) await m.voice.setMute(false, 'Auto-unmute').catch(() => { });
            await removePersistentMute(mute.user_id);
            const channel = guild.channels.cache.find(c => c.name === 'staff-logs' || c.isTextBased());
            if (channel) {
              await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Desmutado').setDescription(`${m.user.tag} desmutado automaticamente (restaurado do banco).`)] }).catch(() => { });
            }
          }
        }, remainingMs);
      }
    } catch (err) {
      console.error('[Boot] Error restoring mutes:', err);
    }
  });

  await client.login(discordConfig.token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});