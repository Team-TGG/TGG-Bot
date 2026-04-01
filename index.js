import 'dotenv/config';
import 'win-ca';



if (process.env.IGNORE_SSL_ERRORS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, Events, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getUsers, getUsersWithElo, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, getClient, reactivateOrAddUser, addPersistentMute, removePersistentMute, getActiveMutes, getMissionWeekStart, getActiveUser } from './src/db.js';
import { addTransaction, updateBalance, getLastDaily, getBalance, getTransactions, getLeaderboard, getShopItems, getShopCount, getShopItemByPosition, hasPurchased, createPurchase, decreaseStock } from './src/tggCoins.js';
import { createClient, runSync, runEloSync } from './src/discord.js';
import { runAndPostGuildActivity } from './src/guildActivity.js';
import { fetchMovimentacao, buildMovimentacaoEmbeds, getDefaultDateRange, isValidDate, formatMovimentacaoAsText } from './src/movimentacao.js';
import { syncNicknames, updateMemberNicknameDiscordPortion, parseNickname, buildNickname, fetchBrawlhallaClanData, loadClanCache } from './src/nicknameSync.js';
import { loadCustomNicknames } from './src/customNicknames.js';
import { discord as discordConfig, ALLOWED_USER_IDS, inactivePlayers as inactivePlayersConfig } from './config/index.js';
import { getUserByDiscordId } from './src/db.js';
import { startCronJobs } from './src/scheduler/cron.js';
import { fetchPlayerStats, fetchClanStats, createStatsEmbed, createRankedEmbed, createClanEmbed, getUserBrawlhallaId, getCached } from './src/brawlhalla.js';
import { addWarning, getUserWarnings, removeWarning, removeLastWarning, parseTime, formatTime as formatModTime, safeSetTimeout } from './src/moderation.js';
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
    'sync': 'sync',
    'sync-guild': 'sync',
    'sync-guild-roles': 'sync',
    'sync-roles': 'sync',
    'sync-elo': 'sync',
    'sync-elo-roles': 'sync',
    'guild-activity': 'guild-activity',
    'activity': 'guild-activity',
    'mov': 'movimentacao',
    'movimentacao': 'movimentacao',
    'sync-nick': 'sync-nick',
    'sync-nicknames': 'sync-nick',
    'refresh-cache': 'refresh-cache',
    'refresh-clan-cache': 'refresh-cache',
    'help': 'help',
    'ajuda': 'help',
    'active': 'active',
    'inac-all': 'inac-all',
    'inac-list': 'inac-list',
    'regras': 'regras',
    'rules': 'regras',
    'missoes': 'missoes',
    'missões': 'missoes',
    'missions': 'missoes',
    'concluida': 'concluida',
    'concluido': 'concluida',
    'comcluido': 'concluida', // Becca
    'cadastrarMissao': 'cadastrarMissao',
    'cadastrarMissão': 'cadastrarMissao',
    'cadastrarmissão': 'cadastrarMissao',
    'cadastrarmissao': 'cadastrarMissao',
    'entrou': 'entrou',
    'stats': 'stats',
    'estatisticas': 'stats',
    'clan': 'clan',
    'clã': 'clan',
    'warn': 'warn',
    'unwarn': 'unwarn',
    'warns': 'warns',
    'warnings': 'warns',
    'mute': 'mute',
    'unmute': 'unmute',
    'ban': 'ban',

    'daily': 'daily',
    'diário': 'daily',
    'diário': 'daily',
    'diario': 'daily',
    'diario': 'daily',
    'balance': 'balance',
    'bal': 'balance',
    'pontos': 'balance',
    'historico': 'historico',
    'histórico': 'historico',
    'transactions': 'historico',
    'leaderboard': 'leaderboard',
    'lb': 'leaderboard',
    'shop': 'shop',
    'loja': 'shop',
    'buy': 'buy',
    'compra': 'buy',
    'comprar': 'buy',
  };
  const EMOJIS = {
    arrowLeft: '<:arrowleft:1475806697162539059>',
    arrowRight: '<:arrowright:1475806826833383456>',
    check: '<:check:1475806856722120838>',
    checkbox: '<:checkbox:1475806904482660476>',
    loading: '<a:loading:1475806256366358633>',
    square: '<:square:1475807057830744074>',
    symboldash: '<:symboldash:1475807293323870238>',
    greaterthan: '<:greaterthan:1475807008010534942>',
    xis2: '<:xis2:1475807173291278369>',
    xis: '<:xis:1475807109554896966>',
    clipboard: '<:clipboard:1475806180621287527>',
    lessthan: '<:lessthan:1475806956437635082>',
    baixo: '<:baixo:1475807866714718239>',
    cima: '<:cima:1475807892782317578>',
    clock: '<:clock:1475829939122212874>',
    success: '<:check:1475806856722120838>',
    crossedSwords: '⚔️',
    hourglass: '⏳',
    scroll: '📜',
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

  async function isAdmin(userId) {
    try {
      const user = await getUserByDiscordId(userId);

      if (!user) return false;
      return user.role?.toLowerCase() === 'admin' && user.active;
    } catch (err) {
      return false;
    }
  }

  function createErrorEmbed(title, message) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`${EMOJIS.xis} ${title}`)
      .setDescription(message)
      .setTimestamp();
  }

  function createSuccessEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`${EMOJIS.success} ${title}`)
      .setDescription(description)
      .setTimestamp();
  }

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const content = message.content.slice(PREFIX.length).trim();
    if (!content) return;

    const args = content.split(/\s+/);
    const rawCommand = args.shift().toLowerCase();
    const command = COMMAND_ALIASES[rawCommand];

    if (!command) return; // impede "." e comandos inexistentes

    // Comandos públicos
    const publicCommands = ['active', 'regras', 'help', 'missoes', 'stats', 'clan', 'daily', 'historico', 'balance', 'leaderboard', 'shop', 'buy'];

    // Verificação de administrador
    if (!publicCommands.includes(command) && !(await isAdmin(message.author.id))) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar estes comandos.')] });
    }

    async function sendCleanMessage(originalMessage, options) {
      try {
        // Tenta editar primeiro. Se falhar (ex: não editável), cai no catch.
        return await originalMessage.edit(options);
      } catch (err) {
        try {
          const newMessage = await originalMessage.channel.send(options);
          await originalMessage.delete().catch(() => { });
          return newMessage;
        } catch (innerErr) {
          return await originalMessage.reply(options).catch(() => originalMessage.channel.send(options));
        }
      }
    }

    try {
      // Comando help - Público
      if (command === 'help') {
        return await handleHelp(message);
      }

      if (command === 'regras') {
        return await handleRegras(message);
      }

      if (command === 'stats') {
        return await handleStats(message, args);
      }

      if (command === 'clan') {
        return await handleClan(message, args);
      }

      if (command === 'missoes') {
        return await handleMissoes(message);
      }

      if (command === 'active') {
        return await handleActive(message, args, client);
      }

      // Comandos de Administração
      if (command === 'sync') {
        return await handleSync(message, client);
      }

      if (command === 'sync-nick') {
        return await handleSyncNick(message, client);
      }

      if (command === 'refresh-cache') {
        return await handleRefreshCache(message);
      }

      if (command === 'warn') {
        return await handleWarn(message, args, client);
      }

      if (command === 'unwarn') {
        return await handleUnwarn(message, args, client);
      }

      if (command === 'warns') {
        return await handleWarns(message, args, client);
      }

      if (command === 'mute') {
        return await handleMute(message, args, client);
      }

      if (command === 'unmute') {
        return await handleUnmute(message, args, client);
      }

      if (command === 'ban') {
        return await handleBan(message, args, client);
      }

      if (command === 'inac-all') {
        return await handleInacAll(message, client);
      }

      if (command === 'inac-list') {
        return await handleInacList(message, client);
      }

      if (command === 'concluida') {
        return await handleConcluida(message, args);
      }

      if (command === 'cadastrarMissao') {
        return await handleCadastrarMissao(message);
      }
      
      if (command === 'entrou') {
        return await handleEntrou(message, client, args);
      }

      // Comandos TGG Coins
      if (command === 'daily') {
        return await handleDaily(message);
      }
      
      if (command === 'balance') {
        return await handleBalance(message, args);
      }
      
      if (command === 'historico') {
        return await handleHistorico(message);
      }
      
      if (command === 'leaderboard') {
        return await handleLeaderboard(message);
      }
      
      if (command === 'shop') {
        return await handleShop(message, args);
      }
      
      if (command === 'buy') {
        return await handleBuy(message, args);
      }

    } catch (err) {
      console.error('[Command Error]', err);
      await message.reply({ embeds: [createErrorEmbed('Erro Interno', `Um erro inesperado ocorreu: ${err.message}`)] }).catch(() => { });
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
