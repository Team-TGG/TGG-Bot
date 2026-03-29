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
    'sync-nick': 'sync-nicknames',
    'sync-nicknames': 'sync-nicknames',
    'refresh-cache': 'refresh-clan-cache',
    'refresh-clan-cache': 'refresh-clan-cache',
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

  // Configura permissões do cargo Muted em todos os canais (incluindo fóruns) — em paralelo
  async function setupMutePermissions(guild, muteRole) {
    const denyPermissions = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.Speak,
    ];

    const targetChannelTypes = [
      ChannelType.GuildText,
      ChannelType.GuildVoice,
      ChannelType.GuildForum,
      ChannelType.GuildStageVoice,
      ChannelType.GuildCategory,
      ChannelType.GuildMedia,
    ];

    const channels = guild.channels.cache.filter(c => targetChannelTypes.includes(c.type));

    // Filtra apenas canais que precisam de atualização
    const channelsToUpdate = [];
    for (const [, channel] of channels) {
      const existingOverwrite = channel.permissionOverwrites.cache.get(muteRole.id);
      if (existingOverwrite) {
        const denied = existingOverwrite.deny;
        const allDenied = denyPermissions.every(p => denied.has(p));
        if (allDenied) continue; // Já está configurado corretamente
      }
      channelsToUpdate.push(channel);
    }

    if (channelsToUpdate.length === 0) return;

    // Atualiza todos os canais em paralelo
    const muteOverrides = {
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      AddReactions: false,
      Speak: false,
    };

    const results = await Promise.allSettled(
      channelsToUpdate.map(channel =>
        channel.permissionOverwrites.edit(muteRole, muteOverrides)
      )
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.error(`[Mute] ${failed.length}/${channelsToUpdate.length} canais falharam ao configurar permissões.`);
    }
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
      if (command === 'help') {
        const page1 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.crossedSwords} Guilda`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .missoes`, value: 'Mostrar as missões da semana atual', inline: false },
            { name: `${EMOJIS.arrowRight} .stats`, value: 'Trazer seus status atualizados do jogo', inline: false },
            { name: `${EMOJIS.arrowRight} .clan`, value: 'Ver informações do clã Team TGG', inline: false },
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page2 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.hourglass} Sincronização`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .sync (admin)`, value: 'Sincronização completa (ranks + ELO)', inline: false },
            { name: `${EMOJIS.arrowRight} .sync-nick (admin)`, value: 'Sincronizar apelidos Brawlhalla', inline: false },
            { name: `${EMOJIS.arrowRight} .refresh-cache (admin)`, value: 'Atualizar cache do clan', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page3 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.clipboard} Informações`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .guild-activity (admin)`, value: 'Sincronizar atividade da guild', inline: false },
            { name: `${EMOJIS.arrowRight} .mov [data-início] [data-fim] (admin)`, value: 'Buscar movimentação (YYYY-MM-DD)', inline: false },
            { name: `${EMOJIS.arrowRight} .regras`, value: 'Mostrar regras da guild', inline: false },
            { name: `${EMOJIS.arrowRight} .help`, value: 'Mostrar esta mensagem', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page4 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.success} Gerenciamento de Usuários`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .entrou <@user> <bhid> (admin)`, value: 'Adicionar novo usuário ou reativar existente no banco de dados', inline: false },
            { name: `${EMOJIS.arrowRight} .warn <@user> [motivo] (admin)`, value: 'Dar um aviso para um membro (3 é o limite)', inline: false },
            { name: `${EMOJIS.arrowRight} .unwarn <@user> [número] (admin)`, value: 'Tirar um warn de um membro', inline: false },
            { name: `${EMOJIS.arrowRight} .warns (admin)`, value: 'Mostrar a listagem de todos os warns', inline: false },
            { name: `${EMOJIS.arrowRight} .mute <@user> <duração> [motivo] (admin)`, value: 'Silenciar um usuário por certo tempo', inline: false },
            { name: `${EMOJIS.arrowRight} .unmute <@user> (admin)`, value: 'Dessilenciar um usuário', inline: false },
            { name: `${EMOJIS.arrowRight} .ban <@user> [motivo] (admin)`, value: 'Banir um usuário do servidor (motivo é opcional)', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page5 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.xis} Inativos`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .inac-all (admin)`, value: 'Dar o cargo "ina" a todos os players inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .active <justificativa>`, value: 'Se remover da lista de inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .active [@user] <justificativa> (admin)`, value: 'Remover jogador da lista de inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .inac-list (admin)`, value: 'Listar todos os jogadores inativos desta semana', inline: false },
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page6 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.scroll} Missões`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .concluida <número> (admin)`, value: 'Marcar a missão do ".missoes" como concluída', inline: false },
            { name: `${EMOJIS.arrowRight} .cadastrarMissao "nome" "dica" <objetivo> (admin)`, value: 'Cadastrar uma missão semanal', inline: false },
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('help_menu')
          .setPlaceholder('Escolha uma categoria...')
          .addOptions(
            { label: 'Guilda', value: 'guild', emoji: EMOJIS.crossedSwords, description: 'Comandos da guilda' },
            { label: 'Sincronização', value: 'sync', emoji: EMOJIS.hourglass, description: 'Comandos de sincronização' },
            { label: 'Informações', value: 'info', emoji: EMOJIS.clipboard, description: 'Comandos de informação' },
            { label: 'Gerenciamento', value: 'users', emoji: EMOJIS.success, description: 'Gerenciamento de usuários' },
            { label: 'Inativos', value: 'inac', emoji: EMOJIS.xis, description: 'Comandos de inatividade' },
            { label: 'Missões', value: 'missions', emoji: EMOJIS.scroll, description: 'Comandos para missões' }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const helpMsg = await message.reply({ embeds: [page1], components: [row] });

        // Coletor para os botões de seleção
        const collector = helpMsg.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== message.author.id) {
            return interaction.reply({ content: 'Você não pode usar este menu', ephemeral: true });
          }

          if (interaction.customId === 'help_menu') {
            const selected = interaction.values[0];
            let embedToShow = page1;
            if (selected === 'sync') embedToShow = page2;
            if (selected === 'info') embedToShow = page3;
            if (selected === 'users') embedToShow = page4;
            if (selected === 'inac') embedToShow = page5;
            if (selected === 'missions') embedToShow = page6;
            await interaction.update({ embeds: [embedToShow], components: [row] });
          }
        });

        collector.on('end', () => {
          // helpMsg.delete().catch(() => {});
        });
      }


      // .guild-activity
      if (command === 'guild-activity') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Buscando atividade da guild...')] });
        try {
          const result = await runAndPostGuildActivity(client);
          if (result.ok) {
            const summary = result.summary || {};
            const resultEmbed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle(`${EMOJIS.check} Atividade Sincronizada`)
              .addFields(
                { name: `${EMOJIS.cima} Entradas`, value: `${summary.entrou ?? 0}`, inline: true },
                { name: `${EMOJIS.baixo} Sa\u00eddas`, value: `${summary.saiu ?? 0}`, inline: true },
                { name: `${EMOJIS.arrowRight} Saldo`, value: `${summary.saldo_liquido ?? 0}`, inline: true }
              )
              .setTimestamp();
            await loading.edit({ embeds: [resultEmbed] });
          }
        } catch (err) {
          await sendCleanMessage(loading, { embeds: [createErrorEmbed('Erro na Sincronização', err.message)] }).catch(() => { });
        }
      }

      // .movimentacao
      if (command === 'movimentacao' || command === 'mov') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Buscando...`).setDescription('Carregando dados de movimentação...')] });
        try {
          let startDate, endDate, queryType = 'range';

          if (args.length >= 3) {
            // Intervalo de datas
            startDate = args[1];
            endDate = args[2];
            if (!isValidDate(startDate) || !isValidDate(endDate)) {
              return loading.edit({ embeds: [createErrorEmbed('Data Inválida', 'Formato: YYYY-MM-DD')] });
            }
            queryType = 'range';
          } else if (args.length === 2) {
            // Data única
            startDate = args[1];
            if (!isValidDate(startDate)) {
              return loading.edit({ embeds: [createErrorEmbed('Data Inválida', 'Formato: YYYY-MM-DD')] });
            }
            endDate = startDate; // Same day
            queryType = 'day';
          } else {
            // Padrão: últimos 7 dias
            const range = getDefaultDateRange();
            startDate = range.startDate;
            endDate = range.endDate;
            queryType = 'range';
          }

          const data = await fetchMovimentacao({ date: queryType === 'day' ? startDate : null, startDate: queryType === 'range' ? startDate : null, endDate: queryType === 'range' ? endDate : null });
          const result = buildMovimentacaoEmbeds(data.data || [], startDate, endDate);

          if (result.needsFile) {
            // Enviar como arquivo se for muito grande
            const textContent = formatMovimentacaoAsText(result.json);
            const attachment = new AttachmentBuilder(Buffer.from(textContent), {
              name: `movimentacao_${startDate}_${endDate}.txt`,
            });
            const dateDisplay = startDate === endDate ? startDate : `${startDate} a ${endDate}`;
            await loading.edit({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xfaa61a)
                  .setTitle(`${EMOJIS.ponto} Guild Movimentação (Arquivo)`)
                  .setDescription(`Dados de ${dateDisplay}\n\nOs dados foram salvos em arquivo de texto pois ultrapassaram o limite de tamanho.`)
                  .addFields([
                    { name: 'Entradas', value: String(result.json.summary.entrou), inline: true },
                    { name: 'Saídas', value: String(result.json.summary.saiu), inline: true },
                    { name: 'Total', value: String(result.json.summary.total), inline: true },
                    { name: 'Promoções', value: String(result.json.summary.promovido), inline: true },
                    { name: 'Rebaixamentos', value: String(result.json.summary.rebaixado), inline: true },
                  ])
                  .setFooter({ text: `Período: ${dateDisplay}` }),
              ],
              files: [attachment],
            });
          } else {
            // Enviar como embeds
            const EMBEDS_PER_MESSAGE = 10;
            for (let i = 0; i < result.embeds.length; i += EMBEDS_PER_MESSAGE) {
              const chunk = result.embeds.slice(i, i + EMBEDS_PER_MESSAGE);
              if (i === 0) await loading.edit({ embeds: chunk }); else await message.reply({ embeds: chunk });
            }
          }
        } catch (err) {
          await sendCleanMessage(loading, { embeds: [createErrorEmbed('Erro na API', err.message)] }).catch(() => { });
        }
      }

      // .sync
      if (command === 'sync') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Executando sincronização completa...')] });
        try {
          const users = await getUsers();
          const guildResult = await runSync(client, users);
          const usersWithElo = await getUsersWithElo();
          const eloResult = await runEloSync(client, usersWithElo);
          const resultEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(`${EMOJIS.check} Sincronização Completa`)
            .addFields(
              { name: 'Ranks', value: `${EMOJIS.check} ${guildResult.synced} | ${EMOJIS.checkbox} ${guildResult.skipped} | ${EMOJIS.xis} ${guildResult.errors}`, inline: true },
              { name: 'ELO', value: `${EMOJIS.check} ${eloResult.synced} | ${EMOJIS.checkbox} ${eloResult.skipped} | ${EMOJIS.xis} ${eloResult.errors}`, inline: true }
            )
            .setTimestamp();
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await loading.edit({ embeds: [createErrorEmbed('Erro de Sincronização', err.message)] });
        }
      }

      // .sync-nicknames
      if (command === 'sync-nicknames' || command === 'sync-nick') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Sincronizando apelidos com clan Brawlhalla...')] });
        try {
          await loadCustomNicknames();
          const result = await syncNicknames(client, discordConfig.guildId);
          const resultEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(`${EMOJIS.check} Apelidos Sincronizados`)
            .addFields(
              { name: `${EMOJIS.check} Sincronizados`, value: `${result.synced}`, inline: true },
              { name: `${EMOJIS.cima} Atualizados`, value: `${result.updated}`, inline: true },
              { name: `${EMOJIS.square} Inalterados`, value: `${result.unchanged}`, inline: true },
              { name: `${EMOJIS.xis} Erros`, value: `${result.failed}`, inline: true }
            )
            .setTimestamp();
          if (result.errors && result.errors.length > 0 && result.errors.length <= 5) {
            const errorList = result.errors.map((e) => `• ${e.error}`).join('\n');
            resultEmbed.addFields({ name: 'Próximos erros', value: errorList, inline: false });
          }
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await loading.edit({ embeds: [createErrorEmbed('Erro de Sincronização', err.message)] });
        }
      }

      // .refresh-clan-cache
      if (command === 'refresh-clan-cache' || command === 'refresh-cache') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Atualizando...`).setDescription('Atualizando cache do clan Brawlhalla...')] });
        try {
          const clanData = await fetchBrawlhallaClanData();
          await sendCleanMessage(loading, { embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`${EMOJIS.check} Cache Atualizado`).setDescription(`${clanData.clan?.length || 0} membros`).addFields({ name: 'Clan', value: `${clanData.clan_name} (${clanData.clan_id})`, inline: true }).setTimestamp()] });
        } catch (err) {
          await sendCleanMessage(loading, { embeds: [createErrorEmbed('Erro ao Atualizar Cache', err.message)] }).catch(() => { });
        }
      }

      // .active
      if (command === 'active') {
        if (!message.guild) {
          return message.reply({ embeds: [createErrorEmbed('Comando Inválido', 'Este comando só pode ser usado no servidor.')] });
        }
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;

          let targetId;
          let note;

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          const idMatch = args[0]?.match(/^\d+$/);

          // Bloqueia comando se não for admin
          if ((mentionMatch || idMatch) && !(await isAdmin(message.author.id))) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Acesso Negado',
                  'Apenas administradores podem ativar outros usuários.'
                )
              ]
            });
          }

          // Comando marcando alguém liberado somente pra admin
          if (await isAdmin(message.author.id) && (mentionMatch || idMatch)) {
            targetId = mentionMatch ? mentionMatch[1] : args[0];

            const afterMention = mentionMatch
              ? message.content.split('>').slice(1).join('>').trim()
              : args.slice(1).join(' ').trim();
            note = afterMention.length > 0 ? afterMention : 'ativado por administrador';
          }
          // Usuário normal usando .active <motivo>
          else {
            targetId = message.author.id;
            note = args.join(' ').trim();

            if (!note || note.length < 15) {
              return message.reply({
                embeds: [
                  createErrorEmbed(
                    'Justificativa obrigatória',
                    'Informe uma justificativa com **pelo menos 15 caracteres**.'
                  )
                ]
              });
            }
          }

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          // Remove cargo de inativo
          if (member.roles.cache.has(inactiveRoleId)) {
            await member.roles.remove(inactiveRoleId);
          }

          // Atualiza banco passando a justificativa
          await removeInactivePlayer(targetId, note);

          const embed = createSuccessEmbed(
            'Ativado',
            `${member.user.tag} foi marcado como ativo.\nMotivo: ${note}`
          );

          await message.reply({ embeds: [embed] });

          // Tratamento de erros
        } catch (err) {

          // Já está ativo
          if (err.message.includes('já está ativo')) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Já está ativo',
                  'Este usuário já está marcado como ativo nesta semana.'
                )
              ]
            });
          }

          // Não está marcado como inativo
          if (err.message.includes('não está marcado como inativo')) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Não está inativo',
                  'Este usuário não está marcado como inativo nesta semana.'
                )
              ]
            });
          }

          // Fallback dos erros
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Ativar Usuário', err.message)]
          });
        }
      }

      // .regras (Display guild rules)
      if (command === 'regras') {
        const rulesEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('📋 Regras da Guild')
          .setDescription('Bem-vindo à TGG! Aqui estão nossas regras simples para uma comunidade saudável.')
          .addFields(
            {
              name: `${EMOJIS.square} Sem Toxicidade`,
              value: 'Proibido nomes ofensivos, assédio ou desrespeito.',
              inline: false
            },
            {
              name: `${EMOJIS.square} Contribua com a Guilda`,
              value: `Ajude a guilda participando de missões, quests e atividades coletivas. Para mais informações, veja o canal <#${'1480627066792579072'}>`,
              inline: false
            },
            {
              name: `${EMOJIS.arrowRight} Como Contribuir:`,
              value: `${EMOJIS.check} Jogar 2v2 amistoso ou ranked com membros da guild\n${EMOJIS.check} Ajudar com missões da guilda`,
              inline: false
            },
            {
              name: `${EMOJIS.arrowRight} Vire membro e desbloqueie treinamentos gratuitos com jogadores experientes da guilda!`,
              value: `${EMOJIS.check} Consiga 40.000 de contribuição total
                      ${EMOJIS.check} Seja MVP Semanal (14 melhores contribuidores da semana)`,
              inline: false
            },
            {
              name: `${EMOJIS.greaterthan} Seja Bem-Vindo!`,
              value: 'Divirta-se, conheça os membros e aproveite a comunidade. Vamos crescer juntos!',
              inline: false
            }
          )
          .setFooter({ text: 'Dúvidas? Fale com um membro da staff!' })
          .setTimestamp();

        await message.reply({ embeds: [rulesEmbed] });
      }

      // .inac-all
      if (command === 'inac-all') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;

          const inactivePlayers = await getInactivePlayers();

          if (inactivePlayers.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Sem Inativos', 'Nenhum jogador com note NULL encontrado.')]
            });
          }

          let applied = 0;
          let failed = 0;

          for (const player of inactivePlayers) {
            try {
              const member = await guild.members.fetch(player.discord_id).catch(() => null);
              if (!member) {
                failed++;
                continue;
              }

              if (!member.roles.cache.has(inactiveRoleId)) {
                await member.roles.add(inactiveRoleId);
              }

              // Notificação por DM
              await member.send({
                embeds: [new EmbedBuilder()
                  .setColor(0xed4245)
                  .setTitle('⚠️ Aviso de Inatividade')
                  .setDescription(`Você está inativo. Para mostrar que está ativo, use o comando \`.active <justificativa>\` no canal <#1468600851290521692>.`)
                  .setTimestamp()]
              }).catch(() => console.log(`Could not send DM to ${player.discord_id}`));

              applied++;
            } catch {
              failed++;
            }
          }

          const embed = createSuccessEmbed(
            'Inativos Aplicados',
            `Cargo aplicado em ${applied} usuário(s).\nFalhas: ${failed}`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Executar inac-all', err.message)]
          });
        }
      }

      // .inac-list
      if (command === 'inac-list') {
        try {
          const inactivePlayers = await getInactivePlayers();

          if (inactivePlayers.length === 0) {
            return message.reply({ embeds: [createErrorEmbed('Sem Inativos', 'Nenhum usuário marcado como inativo no momento')] });
          }

          const itemsPerPage = 10;
          const pages = [];

          for (let i = 0; i < inactivePlayers.length; i += itemsPerPage) {
            const chunk = inactivePlayers.slice(i, i + itemsPerPage);
            const embed = new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle(`📋 Usuários Inativos (${inactivePlayers.length})`)
              .setFooter({ text: `Página ${pages.length + 1} de ${Math.ceil(inactivePlayers.length / itemsPerPage)}` });

            for (let j = 0; j < chunk.length; j++) {
              const player = chunk[j];
              const user = await client.users.fetch(player.discord_id).catch(() => null);
              const createdAt = new Date(player.created_at);
              const daysInactive = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
              const timeStr = daysInactive === 0 ? 'Hoje' : `${daysInactive}d atrás`;

              embed.addFields({
                name: `${i + j + 1}. ${user?.tag || 'Desconhecido'}`,
                value: `ID: ${player.discord_id}\nMarcado: ${timeStr}`,
                inline: false
              });
            }
            pages.push(embed);
          }

          let currentPage = 0;

          const getRow = (page) => {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('prev')
                .setLabel('Anterior')
                .setStyle(1) // Primary
                .setDisabled(page === 0),
              new ButtonBuilder()
                .setCustomId('next')
                .setLabel('Próximo')
                .setStyle(1) // Primary
                .setDisabled(page === pages.length - 1)
            );
            return row;
          };

          const listMsg = await message.reply({
            embeds: [pages[currentPage]],
            components: pages.length > 1 ? [getRow(currentPage)] : []
          });

          if (pages.length > 1) {
            const collector = listMsg.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async (i) => {
              if (i.user.id !== message.author.id) {
                return i.reply({ content: 'Você não pode usar estes botões.', ephemeral: true });
              }

              if (i.customId === 'prev') currentPage--;
              if (i.customId === 'next') currentPage++;

              await i.update({ embeds: [pages[currentPage]], components: [getRow(currentPage)] });
            });

            collector.on('end', () => {
              listMsg.edit({ components: [] }).catch(() => { });
            });
          }
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Listar Inativos', err.message)] });
        }
      }

      // .missoes
      if (command === 'missoes') {
        try {
          const missions = await getWeeklyMissions();

          if (!missions || missions.length === 0) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Missões',
                  'Nenhuma missão encontrada para esta semana.'
                )
              ]
            });
          }

          const weekDate = new Date(missions[0].week_start + 'T00:00:00').toLocaleDateString('pt-BR');

          const description = missions
            .map((m, index) => {

              const isDone = m.status === 'done';

              const statusLabel = isDone ? '✅ [**CONCLUÍDA**]' : '📌';

              const missionText = isDone
                ? `~~🎯 **${index + 1}. ${m.mission}**~~`
                : `🎯 **${index + 1}. ${m.mission}**`;

              const objetivo = isDone
                ? `~~Objetivo: ${m.target} pontos~~`
                : `Objetivo: ${m.target} pontos`;

              const tip = isDone
                ? `~~_DICA: ${m.tip}_~~`
                : `_DICA: ${m.tip}_`;

              return `${statusLabel} ${missionText}
          ${objetivo}
          ${tip}`;
            })
            .join('\n\n');

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📜 Missões Semanais (${weekDate})`)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━\n${description}\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nSe tiver dúvidas, contate alguém da staff.`
            )
            .setTimestamp();

          await message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [
              createErrorEmbed('Erro ao buscar missões', err.message)
            ]
          });
        }
      }

      // .concluida <número>
      if (command === 'concluida') {
        try {
          const numero = parseInt(args[0]);

          if (!numero || numero < 1 || numero > 4) {
            return message.reply({
              embeds: [createErrorEmbed('Missões', 'Informe um número de 1 a 4.')]
            });
          }

          const missions = await getWeeklyMissions();

          if (!missions || missions.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Missões', 'Nenhuma missão encontrada')]
            });
          }

          const mission = missions[numero - 1];

          if (!mission) {
            return message.reply({
              embeds: [createErrorEmbed('Missões', 'Missão inválida')]
            });
          }

          const supabase = getClient();

          const { error } = await supabase
            .from('weekly_missions')
            .update({ status: 'done' })
            .eq('id', mission.id);

          if (error) throw error;

          const embed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Missões')
            .setDescription(`Missão ${numero} marcada como concluída!`)
            .setTimestamp();

          return message.reply({ embeds: [embed] });

        } catch (err) {
          return message.reply({
            embeds: [
              createErrorEmbed('Erro', err.message)
            ]
          });
        }
      }

      // .cadastrarMissao
      if (command === 'cadastrarMissao') {
        try {
          const input = message.content;

          const match = input.match(/"([^"]+)"\s+"([^"]+)"\s+(\d+)/);

          if (!match) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Missões',
                  'Formato inválido.\nUse: .cadastrarMissao "Nome" "Dica" <objetivo>\nUse aspas.\nObjetivo = valor final.'
                )
              ]
            });
          }

          const mission = match[1];
          const tip = match[2];
          const target = parseInt(match[3]);

          const supabase = getClient();

          const weekStart = await getMissionWeekStart();
          const missions = await getWeeklyMissions();

          if (missions.length >= 4) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Missões',
                  'Já existem 4 missões cadastradas para esta semana.'
                )
              ]
            });
          }

          const { error } = await supabase
            .from('weekly_missions')
            .insert([
              {
                week_start: weekStart,
                mission: mission,
                tip: tip,
                target: target,
                status: null
              }
            ]);

          if (error) throw error;

          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('✅ Missões')
            .setDescription(`Missão cadastrada com sucesso!\n\n🎯 ${mission}`)
            .setTimestamp();

          return message.reply({ embeds: [embed] });

        } catch (err) {
          return message.reply({
            embeds: [
              createErrorEmbed('Erro', err.message)
            ]
          });
        }
      }

      // ---- .entrou ----
      if (command === 'entrou') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }

        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          const idMatch = args[0]?.match(/^\d+$/);

          if (!mentionMatch && !idMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.entrou <@user/ID> <brawlhalla_id>`')]
            });
          }

          const targetId = mentionMatch ? mentionMatch[1] : args[0];
          const brawlhallaId = mentionMatch ? args[1] : args[1]; // Correct args index depending on input

          // Re-evaluate args if it was an ID
          const finalBhid = mentionMatch ? args[1] : args[1];

          if (!finalBhid || !/^\d+$/.test(finalBhid)) {
            return message.reply({
              embeds: [createErrorEmbed('Brawlhalla ID Inválido', 'O Brawlhalla ID deve conter apenas números.')]
            });
          }

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          const result = await reactivateOrAddUser(targetId, brawlhallaId, member.user.tag);

          const rolesToRemove = ['1466815420630565069', '1478477041077588098', '1437447173896802395'];
          const rolesToAdd = ['1437441679572471940', '1437427750209327297'];

          for (const roleId of rolesToRemove) {
            if (member.roles.cache.has(roleId)) {
              await member.roles.remove(roleId);
            }
          }

          for (const roleId of rolesToAdd) {
            if (!member.roles.cache.has(roleId)) {
              await member.roles.add(roleId);
            }
          }

          const embed = createSuccessEmbed(
            result.reactivated ? 'Usuário Reativado' : 'Usuário Adicionado',
            `${member.user.tag} foi ${result.reactivated ? 'reativado' : 'adicionado'} ao banco de dados.\n**Brawlhalla ID:** ${brawlhallaId}\n**Cargo:** Recruit\n\nCargos atualizados com sucesso!`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Adicionar Usuário', err.message)]
          });
        }
      }

      // ---- .warn ----
      if (command === 'warn') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          let targetId;
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            targetId = mentionMatch[1];
          } else {
            const idMatch = args[0]?.match(/^\d+$/);
            if (idMatch) targetId = args[0];
          }

          if (!targetId) {
            return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.warn <@user/ID> [motivo]`')] });
          }

          if (await isAdmin(targetId)) {
            return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode dar um aviso a um administrador.')] });
          }

          const reason = message.content.includes('>')
            ? message.content.split('>').slice(1).join('>').trim()
            : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

          const warningCount = await addWarning(targetId, message.author.id, reason);
          await message.reply({ embeds: [createSuccessEmbed('Aviso Adicionado', `${member.user.tag} recebeu um aviso.\n**Motivo:** ${reason}\n**Total de avisos:** ${warningCount}/3`)] });

          if (warningCount === 2) {
            let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
            if (!muteRole) muteRole = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'Cargo para silenciados' });
            await member.roles.add(muteRole);
            setTimeout(() => member.roles.remove(muteRole).catch(() => { }), 15 * 60 * 1000);
            await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle('⚠️ Mute Automático').setDescription(`${member.user.tag} foi silenciado por 15 minutos (2 avisos).`)] });
            // Atualiza permissões em background (não bloqueia resposta)
            setupMutePermissions(guild, muteRole).catch(err => console.error('[Mute] Erro ao configurar permissões:', err));
          } else if (warningCount >= 3) {
            await member.ban({ reason: '3 avisos acumulados' });
            await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('🔨 Ban Automático').setDescription(`${member.user.tag} foi banido por 3 avisos acumulados.`)] });
          }
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Adicionar Aviso', err.message)] });
        }
      }

      // .unwarn
      if (command === 'unwarn') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          let targetId;
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            targetId = mentionMatch[1];
          } else {
            const idMatch = args[0]?.match(/^\d+$/);
            if (idMatch) targetId = args[0];
          }

          if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unwarn <@user/ID>`')] });

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

          const removedWarnNumber = await removeLastWarning(targetId);
          if (!removedWarnNumber) {
            return message.reply({ embeds: [createErrorEmbed('Sem Avisos', 'Este usuário não possui avisos para remover.')] });
          }

          await message.reply({ embeds: [createSuccessEmbed('Aviso Removido', `O último aviso (Aviso **${removedWarnNumber}**) de ${member.user.tag} foi removido.`)] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Remover Aviso', err.message)] });
        }
      }

      // .warns
      if (command === 'warns') {
        try {
          const page = parseInt(args[0]) || 1;
          const pageSize = 10;
          const dbClient = getClient();
          const { data: allWarnings, error } = await dbClient.from('warnings').select('*').order('created_at', { ascending: false });
          if (error) throw error;
          if (!allWarnings || allWarnings.length === 0) return message.reply({ embeds: [createErrorEmbed('Sem Avisos', 'Nenhum aviso encontrado no sistema.')] });

          const byUser = {};
          allWarnings.forEach(w => {
            if (!byUser[w.user_id]) byUser[w.user_id] = { user_id: w.user_id, warnings: [], latest: w.created_at };
            byUser[w.user_id].warnings.push(w);
            if (new Date(w.created_at) > new Date(byUser[w.user_id].latest)) byUser[w.user_id].latest = w.created_at;
          });
          const sorted = Object.values(byUser).sort((a, b) => new Date(b.latest) - new Date(a.latest));
          const totalPages = Math.ceil(sorted.length / pageSize);
          const pageData = sorted.slice((page - 1) * pageSize, page * pageSize);
          if (pageData.length === 0) return message.reply({ embeds: [createErrorEmbed('Página Inválida', `Apenas ${totalPages} página(s) disponíveis.`)] });

          const embed = new EmbedBuilder().setColor(0xfaa61a).setTitle(`⚠️ Lista de Avisos (${page}/${totalPages})`).setDescription(`${sorted.length} usuários com avisos`).setTimestamp();
          for (const ud of pageData) {
            const user = await client.users.fetch(ud.user_id).catch(() => null);
            embed.addFields({ name: `${ud.warnings.length} avisos — ${user?.tag || ud.user_id}`, value: `Último: ${new Date(ud.latest).toLocaleDateString('pt-BR')}\n${ud.warnings.slice(0, 2).map(w => `• ${w.reason}`).join('\n')}`, inline: false });
          }

          const navRow = new ActionRowBuilder();
          if (page > 1) navRow.addComponents(new ButtonBuilder().setCustomId(`warns_${page - 1}`).setLabel('⬅️').setStyle(2));
          navRow.addComponents(new ButtonBuilder().setLabel(`${page}/${totalPages}`).setStyle(2).setDisabled(true).setCustomId('page_label'));
          if (page < totalPages) navRow.addComponents(new ButtonBuilder().setCustomId(`warns_${page + 1}`).setLabel('➡️').setStyle(2));

          const reply = await message.reply({ embeds: [embed], components: navRow.components.length > 1 ? [navRow] : [] });
          const col = reply.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 60000 });
          col.on('collect', async i => {
            const np = parseInt(i.customId.split('_')[1]);
            const nd = sorted.slice((np - 1) * pageSize, np * pageSize);
            const ne = new EmbedBuilder().setColor(0xfaa61a).setTitle(`⚠️ Lista de Avisos (${np}/${totalPages})`).setDescription(`${sorted.length} usuários com avisos`).setTimestamp();
            for (const ud of nd) {
              const user = await client.users.fetch(ud.user_id).catch(() => null);
              ne.addFields({ name: `${ud.warnings.length} avisos — ${user?.tag || ud.user_id}`, value: `Último: ${new Date(ud.latest).toLocaleDateString('pt-BR')}\n${ud.warnings.slice(0, 2).map(w => `• ${w.reason}`).join('\n')}`, inline: false });
            }
            const nr = new ActionRowBuilder();
            if (np > 1) nr.addComponents(new ButtonBuilder().setCustomId(`warns_${np - 1}`).setLabel('⬅️').setStyle(2));
            nr.addComponents(new ButtonBuilder().setLabel(`${np}/${totalPages}`).setStyle(2).setDisabled(true).setCustomId('page_label'));
            if (np < totalPages) nr.addComponents(new ButtonBuilder().setCustomId(`warns_${np + 1}`).setLabel('➡️').setStyle(2));
            await i.update({ embeds: [ne], components: nr.components.length > 1 ? [nr] : [] });
          });
          col.on('end', () => reply.edit({ components: [] }).catch(() => { }));
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Listar Avisos', err.message)] });
        }
      }

      // .mute
      if (command === 'mute') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          let targetId;
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            targetId = mentionMatch[1];
          } else {
            const idMatch = args[0]?.match(/^\d+$/);
            if (idMatch) targetId = args[0];
          }

          if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.mute <@user/ID> <duração> [motivo]` — ex: `.mute @user 1h sendo tóxico`')] });

          if (await isAdmin(targetId)) {
            return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode silenciar um administrador.')] });
          }

          const durationMatch = message.content.match(/\b(\d+[smhdMy])\b/);
          if (!durationMatch) return message.reply({ embeds: [createErrorEmbed('Duração Inválida', 'Formatos: 1s, 1m, 1h, 1d, 1M, 1y')] });
          const durationMs = parseTime(durationMatch[1]);
          if (!durationMs) return message.reply({ embeds: [createErrorEmbed('Duração Inválida', 'Formato não reconhecido.')] });

          // Extrai motivo (tudo depois da duração)
          const durationIndex = message.content.indexOf(durationMatch[1]);
          const reason = message.content.slice(durationIndex + durationMatch[1].length).trim() || 'Sem motivo especificado';

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

          let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
          if (!muteRole) muteRole = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'Cargo para silenciados' });
          await member.roles.add(muteRole);
          if (member.voice.channel) await member.voice.setMute(true, 'Moderação').catch(() => { });

          const expiresAt = new Date(Date.now() + durationMs).toISOString();
          await addPersistentMute(targetId, expiresAt);

          await message.reply({ embeds: [createSuccessEmbed('Silenciado', `${member.user.tag} silenciado por ${formatModTime(durationMs)}.\n**Motivo:** ${reason}`)] });

          // Atualiza permissões em background (não bloqueia resposta)
          setupMutePermissions(guild, muteRole).catch(err => console.error('[Mute] Erro ao configurar permissões:', err));

          safeSetTimeout(async () => {
            const m = await guild.members.fetch(targetId).catch(() => null);
            if (m?.roles.cache.has(muteRole.id)) {
              await m.roles.remove(muteRole).catch(() => { });
              if (m.voice.serverMute) await m.voice.setMute(false, 'Auto-unmute').catch(() => { });
              await removePersistentMute(targetId);
              await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Desmutado').setDescription(`${m.user.tag} desmutado automaticamente.`)] }).catch(() => { });
            }
          }, durationMs);
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Silenciar', err.message)] });
        }
      }

      // .unmute
      if (command === 'unmute') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          let targetId;
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            targetId = mentionMatch[1];
          } else {
            const idMatch = args[0]?.match(/^\d+$/);
            if (idMatch) targetId = args[0];
          }

          if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unmute <@user/ID>`')] });

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });
          const muteRole = guild.roles.cache.find(r => r.name === 'Muted');
          if (!muteRole || !member.roles.cache.has(muteRole.id)) return message.reply({ embeds: [createErrorEmbed('Não Silenciado', 'Este usuário não está silenciado.')] });
          await member.roles.remove(muteRole);
          if (member.voice.serverMute) await member.voice.setMute(false, 'Moderação').catch(() => { });
          await removePersistentMute(targetId);
          await message.reply({ embeds: [createSuccessEmbed('Desmutado', `${member.user.tag} desmutado com sucesso.`)] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Desmutar', err.message)] });
        }
      }

      // .ban
      if (command === 'ban') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          let targetId;
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            targetId = mentionMatch[1];
          } else {
            const idMatch = args[0]?.match(/^\d+$/);
            if (idMatch) targetId = args[0];
          }

          if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.ban <@user/ID> [motivo]`')] });

          if (await isAdmin(targetId)) {
            return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode banir um administrador.')] });
          }

          const reason = message.content.includes('>')
            ? message.content.split('>').slice(1).join('>').trim()
            : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });
          await member.ban({ reason });
          await message.reply({ embeds: [createSuccessEmbed('Banido', `${member.user.tag} foi banido.\n**Motivo:** ${reason}`)] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Banir', err.message)] });
        }
      }

      // .stats
      if (command === 'stats') {
        try {
          let targetUserId = message.author.id;
          if (args.length > 0) {
            const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
            if (mentionMatch) {
              targetUserId = mentionMatch[1];
            } else if (/^\d+$/.test(args[0])) {
              targetUserId = args[0];
            }
          }

          const brawlhallaId = await getUserBrawlhallaId(targetUserId);
          if (!brawlhallaId) {
            return await message.reply({ embeds: [createErrorEmbed('Brawlhalla ID Não Encontrado', 'Este usuário não tem um Brawlhalla ID registrado.')] });
          }

          const loadingEmbed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle(`${EMOJIS.loading} Carregando estatísticas...`)
            .setDescription('Buscando dados do Brawlhalla...');

          const loadingMsg = await message.reply({ embeds: [loadingEmbed] });
          const playerData = await fetchPlayerStats(brawlhallaId);

          const mainEmbed = createStatsEmbed(playerData);
          const rankedEmbed = createRankedEmbed(playerData);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('stats_main').setLabel('Geral').setStyle(1),
            new ButtonBuilder().setCustomId('stats_ranked').setLabel('Ranked').setStyle(1)
          );

          const statsMsg = await sendCleanMessage(loadingMsg, { embeds: [mainEmbed], components: [row] });

          const collector = statsMsg.createMessageComponentCollector({ time: 300000 });

          collector.on('collect', async (i) => {
            try {
              if (i.user.id !== message.author.id) {
                return i.reply({ content: 'Você não pode usar estes botões.', ephemeral: true }).catch(() => { });
              }

              if (i.customId === 'stats_main') {
                await i.update({ embeds: [mainEmbed], components: [row] }).catch(() => { });
              } else if (i.customId === 'stats_ranked') {
                await i.update({ embeds: [rankedEmbed], components: [row] }).catch(() => { });
              }
            } catch (err) {
              console.error('[Interaction] Error handled in collector:', err.message);
            }
          });

          collector.on('end', () => {
            // statsMsg.delete().catch(() => {});
          });

        } catch (err) {
          console.error('Error fetching stats:', err);
          const errorEmbed = createErrorEmbed('Erro ao Buscar Estatísticas', err.message);
          if (loadingMsg) {
            await sendCleanMessage(loadingMsg, { embeds: [errorEmbed] }).catch(() => { });
          } else {
            await message.reply({ embeds: [errorEmbed] }).catch(() => { });
          }
        }
      }

      // .clan
      if (command === 'clan') {
        try {
          let clanId = process.env.BRAWLHALLA_CLAN_ID || '396943';
          if (args.length > 0 && /^\d+$/.test(args[0])) {
            clanId = args[0];
          }

          // Checar cache primeiro (inclusive expirado)
          const cachedData = getCached(`clan:${clanId}`, true);
          if (cachedData) {
            return await message.reply({ embeds: [createClanEmbed(cachedData)] });
          }

          const loadingEmbed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle(`${EMOJIS.loading} Carregando informações do clã...`)
            .setDescription('Buscando dados do Brawlhalla...');

          const loadingMsg = await message.reply({ embeds: [loadingEmbed] });
          const clanData = await fetchClanStats(clanId);
          await sendCleanMessage(loadingMsg, { embeds: [createClanEmbed(clanData)] });

        } catch (err) {
          console.error('Error fetching clan stats:', err);
          const errorEmbed = createErrorEmbed('Erro ao Buscar Estatísticas do Clã', err.message);
          if (loadingMsg) {
            await sendCleanMessage(loadingMsg, { embeds: [errorEmbed] }).catch(() => { });
          } else {
            await message.reply({ embeds: [errorEmbed] }).catch(() => { });
          }
        }
      }

      // COMANDOS TGG COINS
      // .daily
      if (command === 'daily') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle(`${EMOJIS.loading} Resgatando daily...`)
          ]
        });

        try {
          const discordId = message.author.id;

          // Verifica se o usuário é ativo
          const user = await getUserByDiscordId(discordId);

          if (!user || !user.active) {
            return loading.edit({
              embeds: [
                createErrorEmbed('Acesso Negado', 'Você não está na guilda.')
              ]
            });
          }

          // Pega o horário do último daily
          const lastDaily = await getLastDaily(discordId);

          const now = new Date();

          if (lastDaily) {
            const last = new Date(lastDaily.created_at);
            const diffHours = (now - last) / (1000 * 60 * 60);

            if (diffHours < 24) {
              return loading.edit({
                embeds: [
                  createErrorEmbed(
                    'Daily já resgatado',
                    `Volte em ${Math.ceil(24 - diffHours)}h`
                  )
                ]
              });
            }
          }

          const reward = 500;

          // Adiciona o valor como "Daily" e atualiza o saldo
          await addTransaction(discordId, reward, 'DAILY', 'Recompensa diária');
          const newBalance = await updateBalance(discordId, reward);

          return loading.edit({
            embeds: [
              createSuccessEmbed(
                'TGG Coins recebidas!',
                `+${reward} TGG-Coins 💰\nSaldo atual: **${newBalance}**`
              )
            ]
          });

        } catch (err) {
          return loading.edit({
            embeds: [createErrorEmbed('Erro no daily', err.message)]
          });
        }
      }
      
      // .balance
      if (command === 'balance') {
        try {
          const discordId = message.author.id;

          const user = await getUserByDiscordId(discordId);
          if (!user || !user.active) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Você não está na guilda.')]
            });
          }

          const balance = await getBalance(discordId);

          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`💰 Seu saldo`)
                .setDescription(`Você possui **${balance} TGG-Coins**`)
                .setTimestamp()
            ]
          });

        } catch (err) {
          return message.reply({
            embeds: [createErrorEmbed('Erro', err.message)]
          });
        }
      }

      // .historico
      if (command === 'historico') {
        try {
          const discordId = message.author.id;

          const user = await getUserByDiscordId(discordId);
          if (!user || !user.active) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Você não está na guilda.')]
            });
          }

          let page = 1;
          const limit = 10;

          async function generateEmbed(page) {
            const { data, total } = await getTransactions(discordId, page, limit);

            const totalPages = Math.ceil(total / limit) || 1;

            if (data.length === 0) {
              return new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('📜 Histórico vazio')
                .setDescription('Você não possui transações.');
            }

            const description = data.map(t => {
              const date = new Date(t.created_at).toLocaleString('pt-BR');

              const sinal = t.amount >= 0 ? '+' : '-';

              return `**${sinal}${Math.abs(t.amount)}** | ${t.type}\n${date}`;
            }).join('\n\n');

            return new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('📜 Seu histórico')
              .setDescription(description)
              .setFooter({ text: `Página ${page}/${totalPages}` })
              .setTimestamp();
          }

          const row = (page, totalPages) => new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('prev')
              .setLabel('⬅️')
              .setStyle(1)
              .setDisabled(page <= 1),

            new ButtonBuilder()
              .setCustomId('next')
              .setLabel('➡️')
              .setStyle(1)
              .setDisabled(page >= totalPages)
          );

          let { total } = await getTransactions(discordId, page, limit);
          let totalPages = Math.ceil(total / limit) || 1;

          const msg = await message.reply({
            embeds: [await generateEmbed(page)],
            components: [row(page, totalPages)]
          });

          const collector = msg.createMessageComponentCollector({
            time: 60000
          });

          collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) {
              return interaction.reply({
                content: 'Você não pode usar isso.',
                ephemeral: true
              });
            }

            if (interaction.customId === 'prev') page--;
            if (interaction.customId === 'next') page++;

            let { total } = await getTransactions(discordId, page, limit);
            let totalPages = Math.ceil(total / limit) || 1;

            await interaction.update({
              embeds: [await generateEmbed(page)],
              components: [row(page, totalPages)]
            });
          });

        } catch (err) {
          return message.reply({
            embeds: [createErrorEmbed('Erro', err.message)]
          });
        }
      }

      // .leaderboard
      if (command === 'leaderboard') {
        try {
          let page = 1;
          const limit = 10;

          async function generateEmbed(page) {
            const { data, total } = await getLeaderboard(page, limit);

            const totalPages = Math.ceil(total / limit) || 1;

            if (data.length === 0) {
              return new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('🏆 Leaderboard vazio');
            }

            const description = await Promise.all(
              data.map(async (user, index) => {
                const position = (page - 1) * limit + index + 1;

                let username = `ID: ${user.discord_id}`;

                try {
                  const member = await message.guild.members.fetch(user.discord_id);
                  username = member.user.username;
                } catch (e) {}

                const medal =
                  position === 1 ? '🥇' :
                  position === 2 ? '🥈' :
                  position === 3 ? '🥉' :
                  `#${position}`;

                return `${medal} **${username}** — ${user.balance} TGG-Coins`;
              })
            );

            return new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('🏆 Leaderboard')
              .setDescription(description.join('\n'))
              .setFooter({ text: `Página ${page}/${totalPages}` })
              .setTimestamp();
          }

          const row = (page, totalPages) => new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('prev_lb')
              .setLabel('⬅️')
              .setStyle(1)
              .setDisabled(page <= 1),

            new ButtonBuilder()
              .setCustomId('next_lb')
              .setLabel('➡️')
              .setStyle(1)
              .setDisabled(page >= totalPages)
          );

          let { total } = await getLeaderboard(page, limit);
          let totalPages = Math.ceil(total / limit) || 1;

          const msg = await message.reply({
            embeds: [await generateEmbed(page)],
            components: [row(page, totalPages)]
          });

          const collector = msg.createMessageComponentCollector({
            time: 60000
          });

          collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) {
              return interaction.reply({
                content: 'Você não pode usar isso.',
                ephemeral: true
              });
            }

            if (interaction.customId === 'prev_lb') page--;
            if (interaction.customId === 'next_lb') page++;

            let { total } = await getLeaderboard(page, limit);
            let totalPages = Math.ceil(total / limit) || 1;

            await interaction.update({
              embeds: [await generateEmbed(page)],
              components: [row(page, totalPages)]
            });
          });

        } catch (err) {
          return message.reply({
            embeds: [createErrorEmbed('Erro', err.message)]
          });
        }
      }

      // .shop
      if (command === 'shop') {
        try {
          const discordId = message.author.id;

          const user = await getUserByDiscordId(discordId);
          if (!user || !user.active) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Você não está na guilda.')]
            });
          }

          const limit = 5;

          let page = parseInt(args[0]);
          if (isNaN(page) || page < 1) page = 1;

          const totalItems = await getShopCount();
          const totalPages = Math.ceil(totalItems / limit) || 1;

          // Joga pra última página existente
          if (page > totalPages) page = totalPages;

          async function generateEmbed(page) {
            const { data } = await getShopItems(page, limit);

            const embed = new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('🛒 Loja')
              .setFooter({ text: `Página ${page}/${totalPages}` })
              .setTimestamp();

            data.forEach((item, index) => {
              const position = (page - 1) * limit + index + 1;

              let extra = '';

              if (item.is_unique) extra += ' 🔒 Único';
              if (item.stock !== null) extra += ` • Estoque: ${item.stock}`;

              embed.addFields({
                name: `#${position} • ${item.name}`,
                value: `${item.description || 'Sem descrição'}\n💰 **${item.price} TGG-Coins**${extra}`,
                inline: false
              });
            });

            return embed;
          }

          const row = (page) => {
            if (totalPages <= 1) return [];

            return [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('shop_prev')
                  .setLabel('⬅️')
                  .setStyle(1)
                  .setDisabled(page <= 1),

                new ButtonBuilder()
                  .setCustomId('shop_next')
                  .setLabel('➡️')
                  .setStyle(1)
                  .setDisabled(page >= totalPages)
              )
            ];
          };

          const msg = await message.reply({
            embeds: [await generateEmbed(page)],
            components: row(page)
          });

          if (totalPages <= 1) return;

          const collector = msg.createMessageComponentCollector({
            time: 60000
          });

          collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) {
              return interaction.reply({
                content: 'Você não pode usar isso.',
                ephemeral: true
              });
            }

            if (interaction.customId === 'shop_prev') page--;
            if (interaction.customId === 'shop_next') page++;

            await interaction.update({
              embeds: [await generateEmbed(page)],
              components: row(page)
            });
          });

        } catch (err) {
          return message.reply({
            embeds: [createErrorEmbed('Erro na loja', err.message)]
          });
        }
      }

      // .buy
      if (command === 'buy') {
        try {
          const discordId = message.author.id;

          const user = await getUserByDiscordId(discordId);
          if (!user || !user.active) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Você não está na guilda.')]
            });
          }

          const position = parseInt(args[0]);

          if (isNaN(position) || position < 1) {
            return message.reply({
              embeds: [createErrorEmbed('Uso inválido', 'Use: `.buy <número do item>`')]
            });
          }

          // Pega o número do item
          const item = await getShopItemByPosition(position);

          if (!item) {
            return message.reply({
              embeds: [createErrorEmbed('Item não encontrado', 'Esse item não existe.')]
            });
          }

          // Se for um item único
          if (item.is_unique) {
            const alreadyHas = await hasPurchased(discordId, item.id);
            if (alreadyHas) {
              return message.reply({
                embeds: [createErrorEmbed('Item único', 'Você já comprou este item.')]
              });
            }
          }

          // Se não tiver estoque
          if (item.stock !== null && item.stock <= 0) {
            return message.reply({
              embeds: [createErrorEmbed('Sem estoque', 'Este item acabou.')]
            });
          }

          // Ver o saldo do usuário
          const balance = await getBalance(discordId);

          // Se não tiver saldo suficiente, trava
          if (balance < item.price) {
            return message.reply({
              embeds: [createErrorEmbed('Saldo insuficiente', `Você precisa de ${item.price} TGG-Coins.`)]
            });
          }

          // Adiciona a transação
          await addTransaction(discordId, -item.price, 'SHOP_PURCHASE', 'Compra');

          // Atualizar o saldo
          const newBalance = await updateBalance(discordId, -item.price);

          // Registrar a compra
          await createPurchase(discordId, item);

          // Diminuir estoque (Se tiver estoque)
          await decreaseStock(item.id, item.stock);

          // Para itens que são cargos, aplicar cargo
          if (item.type === 'ROLE' && item.role_id) {
            try {
              const member = await message.guild.members.fetch(discordId);
              await member.roles.add(item.role_id);
            } catch (err) {
              console.error('Erro ao adicionar cargo:', err);
            }
          }

          return message.reply({
            embeds: [
              createSuccessEmbed(
                'Compra realizada!',
                `Você comprou **${item.name}** por ${item.price} TGG-Coins.\nSaldo atual: **${newBalance}**`
              )
            ]
          });

        } catch (err) {
          return message.reply({
            embeds: [createErrorEmbed('Erro na compra', err.message)]
          });
        }
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
