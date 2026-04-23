// public.js - Comandos públicos
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Events, PermissionFlagsBits, ChannelType } from 'discord.js';
import { removeInactivePlayer, getWeeklyMissions, getMissionWeekEnd, addMotd, getLastMotd, getBirthdayByUserId, addBirthday, formatCreatedAtBR, getMissionWeekStartDateTime, getWeeklyInitial, loadAliases, resolveBrawlhallaId } from './db.js';

import { fetchPlayerStats, fetchClanStats, createStatsEmbed, createRankedEmbed, createClanEmbed, getUserBrawlhallaId, getCached } from './brawlhalla.js';
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig } from '../config/index.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from '../utils/discordUtils.js';
import { isAdmin, adminOnly} from '../utils/permissions.js';
import { EMOJIS } from '../config/emojis.js';

// .help
export async function handleHelp(message, args, client) {
  const page1 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.crossedSwords} Guilda`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .missoes`, value: 'Mostrar as missões da semana atual', inline: false },
      { name: `${EMOJIS.arrowRight} .stats`, value: 'Trazer seus status atualizados do jogo', inline: false },
      { name: `${EMOJIS.arrowRight} .games`, value: 'Mostra a quantidade de jogos jogados durante a SEMANA', inline: false },
      { name: `${EMOJIS.arrowRight} .clan`, value: 'Ver informações do clã Team TGG', inline: false },
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page2 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.hourglass} Sincronização`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .sync`, value: 'Sincronização dos membros que precisam ser atualizados (ranks + ELO)', inline: false },
      { name: `${EMOJIS.arrowRight} .sync-all`, value: 'Sincronização completa de todos os membros (ranks + ELO)', inline: false },
      { name: `${EMOJIS.arrowRight} .sync-nick`, value: 'Sincronizar apelidos Brawlhalla', inline: false },
      { name: `${EMOJIS.arrowRight} .refresh-cache`, value: 'Atualizar cache do clan', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page3 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.clipboard} Informações`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .regras`, value: 'Mostrar regras da guild', inline: false },
      { name: `${EMOJIS.arrowRight} .help`, value: 'Mostrar esta mensagem', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page4 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.success} Gerenciamento de Usuários`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .entrou <@user> <bhid>`, value: 'Adicionar novo usuário ou reativar existente no banco de dados', inline: false },
      { name: `${EMOJIS.arrowRight} .warn <@user> [motivo]`, value: 'Dar um aviso para um membro (3 é o limite)', inline: false },
      { name: `${EMOJIS.arrowRight} .unwarn <@user> [número]`, value: 'Tirar um warn de um membro', inline: false },
      { name: `${EMOJIS.arrowRight} .warns`, value: 'Mostrar a listagem de todos os warns', inline: false },
      { name: `${EMOJIS.arrowRight} .mute <@user> <duração> [motivo]`, value: 'Silenciar um usuário por certo tempo', inline: false },
      { name: `${EMOJIS.arrowRight} .unmute <@user>`, value: 'Dessilenciar um usuário', inline: false },
      { name: `${EMOJIS.arrowRight} .ban <@user> [motivo]`, value: 'Banir um usuário do servidor (motivo é opcional)', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page5 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.xis} Inativos`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .inac-all`, value: 'Dar o cargo "ina" a todos os players inativos', inline: false },
      { name: `${EMOJIS.arrowRight} .active <justificativa>`, value: 'Se remover da lista de inativos', inline: false },
      { name: `${EMOJIS.arrowRight} .active [@user] <justificativa>`, value: 'Remover jogador da lista de inativos', inline: false },
      { name: `${EMOJIS.arrowRight} .inac-list`, value: 'Listar todos os jogadores inativos desta semana', inline: false },
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page6 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.scroll} Missões`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .concluida <número>`, value: 'Marcar a missão do ".missoes" como concluída', inline: false },
      { name: `${EMOJIS.arrowRight} .cadastrarMissao "nome" "dica" <objetivo>`, value: 'Cadastrar uma missão semanal', inline: false },
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page7 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.TGGcoin} TGG Coins`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .daily`, value: 'Receber as moedas diárias (+0.4x para MVP Semanal e +0.2x pra VIP)', inline: false },
      { name: `${EMOJIS.arrowRight} .streak`, value: 'Ver sua sequência atual de daily/diárias', inline: false },
      { name: `${EMOJIS.arrowRight} .conquistas`, value: 'Ver as conquistas cadastradas da semana, complete para ganhar TGG Coins', inline: false },
      { name: `${EMOJIS.arrowRight} .balance (.bal)`, value: 'Ver a quantidade atual de moedas que você tem', inline: false },
      { name: `${EMOJIS.arrowRight} .historico (.hist)`, value: 'Ver seu histórico de gastos', inline: false },
      { name: `${EMOJIS.arrowRight} .leaderboard (.lb)`, value: 'Ver um leaderboard com as pessoas que mais tem TGG-Coins', inline: false },
      { name: `${EMOJIS.arrowRight} .shop`, value: 'Ver a loja de itens', inline: false },
      { name: `${EMOJIS.arrowRight} .buy <número do item>`, value: 'Fazer uma compra de um item da loja (usar o número que aparece ao lado do item)', inline: false },
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const isUserAdmin = await isAdmin(message.author.id);

  const options = [
    { label: 'Guilda', value: 'guild', emoji: EMOJIS.crossedSwords, description: 'Comandos da guilda' },
    { label: 'Informações', value: 'info', emoji: EMOJIS.clipboard, description: 'Comandos de informação' },
    { label: 'TGG Coins', value: 'tggcoins', emoji: EMOJIS.TGGcoin, description: 'Comandos TGG Coins' }
  ];

  // Só adiciona se for admin
  if (isUserAdmin) {
    options.push(
      { label: 'Sincronização (admin).', value: 'sync', emoji: EMOJIS.hourglass, description: 'Comandos de sincronização' },
      { label: 'Gerenciamento (admin).', value: 'users', emoji: EMOJIS.success, description: 'Gerenciamento de usuários' },
      { label: 'Inativos (admin).', value: 'inac', emoji: EMOJIS.xis, description: 'Comandos de inatividade' },
      { label: 'Missões (admin).', value: 'missions', emoji: EMOJIS.scroll, description: 'Comandos para missões' }
    );
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('help_menu')
    .setPlaceholder('Escolha uma categoria...')
    .addOptions(options);

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
      if (selected === 'tggcoins') embedToShow = page7;
      await interaction.update({ embeds: [embedToShow], components: [row] });
    }
  });

  collector.on('end', () => {
    // helpMsg.delete().catch(() => {});
  });
}

// .regras
export async function handleRegras(message, args, client) {
  const rulesEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Regras da Guild')
    .setDescription('Bem-vindo à TGG! Aqui estão nossas regras simples para uma comunidade saudável.')
    .addFields(
      {
        name: `${EMOJIS.square} Sem Toxicidade`,
        value: `${EMOJIS.xis} Proibido nomes ofensivos.
                ${EMOJIS.xis} Evite mal comportamento dentro e fora do jogo.
                ${EMOJIS.check} Reporte comportamentos indevidos dos membros no <#1461132037908856964>.`,
        inline: false
      },
      {
        name: `${EMOJIS.square} Contribua com a Guilda`,
        value: `${EMOJIS.check} Ajude a guilda participando de missões, quests e atividades coletivas. Para mais informações, veja o canal <#${'1480627066792579072'}>`,
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
        name: `${EMOJIS.arrowRight} Exigimos um mínimo de 1.000 de contribuição semanal, para conferir, basta verificar na aba da guilda dentro do jogo!`,
        value: `${EMOJIS.check} Missões começam na quinta às 6 da manhã e vão até quarta às 6 da manhã!
                ${EMOJIS.check} Se ficar inativo, o <@1470608096056447006> vai mandar uma mensagem privada.
                ${EMOJIS.check} Para justificar, use ".active <motivo>" no canal informado pelo bot.`,
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

// .motd
export async function handleMotd(message, args, client) {
  try {
    const motdMessage = args.join(' ').trim();

    if (!motdMessage) {
      return message.reply({
        embeds: [createErrorEmbed('Mensagem Vazia', 'Uso: `.motd <mensagem>`')]
      });
    }

    if (motdMessage.length > 255) {
      return message.reply({
        embeds: [createErrorEmbed('Mensagem Longa', 'A mensagem deve ter no máximo 255 caracteres.')]
      });
    }

    // Pega a última motd
    const lastMotd = await getLastMotd(message.author.id);

    if (lastMotd) {
      const lastDate = new Date(lastMotd.created_at);
      const now = new Date();

      const diffMs = now - lastDate;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      // Bloquear mensagens pelo mesmo membro se já tiver enviado uma nos últimos 7 dias
      if (diffDays < 7) {
        const daysLeft = Math.ceil(7 - diffDays);

        return message.reply({
          embeds: [
            createErrorEmbed(
              'Aguarde para enviar novamente',
              `Você já enviou uma mensagem recentemente.\nTente novamente em **${daysLeft} dia(s)**.`
            )
          ]
        });
      }
    }

    await addMotd(message.author.id, motdMessage);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('📢 Mensagem do Dia')
      .setDescription('Sua mensagem foi salva com sucesso e será sorteada no site!')
      .addFields({ name: 'Mensagem', value: `"${motdMessage}"` })
      .setFooter({ text: 'TGG Bot • MOTD' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });

  } catch (err) {
    console.error('Erro ao salvar MOTD:', err);
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Salvar', 'Não foi possível salvar sua mensagem no momento.')]
    });
  }
}

// .stats
export async function handleStats(message, args, client) {
  let loadingMsg = null;
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
    const legendsEmbed = (await import('./brawlhalla.js')).createLegendsStatsEmbed(playerData);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('stats_main').setLabel('Geral').setStyle(1),
      new ButtonBuilder().setCustomId('stats_ranked').setLabel('Ranked').setStyle(1),
      new ButtonBuilder().setCustomId('stats_legends').setLabel('Legends').setStyle(1)
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
        } else if (i.customId === 'stats_legends') {
          await i.update({ embeds: [legendsEmbed], components: [row] }).catch(() => { });
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

// .games
export async function handleGames(message, args) {
  let loadingMsg = null;
  try {
    let targetUserId = message.author.id;
    let requestedAnotherUser = false;

    const isUserAdmin = await isAdmin(message.author.id);

    if (args.length > 0) {
      const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
      if (mentionMatch) {
        targetUserId = mentionMatch[1];
        requestedAnotherUser = true;
      } else if (/^\d+$/.test(args[0])) {
        targetUserId = args[0];
        requestedAnotherUser = true;
      }
    }

    if (requestedAnotherUser && !isUserAdmin) {
      return await message.reply({
        embeds: [
          createErrorEmbed(
            'Acesso negado',
            'Você só pode ver seus próprios dados.'
          )
        ]
      });
    }

    let brawlhallaId = await getUserBrawlhallaId(targetUserId);

    // Garante que os aliases estão carregados
    await loadAliases();

    // Caso esteja com ID de algum alt, tenta resolver para o ID principal
    if (brawlhallaId) {
      brawlhallaId = resolveBrawlhallaId(String(brawlhallaId));
    }

    if (!brawlhallaId) {
      return await message.reply({
        embeds: [createErrorEmbed('Erro', 'Usuário sem Brawlhalla ID')]
      });
    }

    const loadingEmbed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle('Carregando...')
      .setDescription('Buscando dados semanais...');

    loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    const weekStart = getMissionWeekStartDateTime();
    const initial = await getWeeklyInitial(brawlhallaId, weekStart);

    if (!initial) {
      return await sendCleanMessage(loadingMsg, {
        embeds: [createErrorEmbed('Erro', 'Dados semanais não encontrados')]
      });
    }

    const stats = await fetchPlayerStats(brawlhallaId);
    const ranked = stats.ranked;

    const currentGames = stats['games'] ?? 0;
    const current1v1 = ranked['games'] ?? 0;

    let current2v2 = 0;
    if (ranked['2v2']) {
      ranked['2v2'].forEach(t => {
        current2v2 += t.games ?? 0;
      });
    }

    const current3v3 = ranked['rotating_ranked']?.games ?? 0;

    const totalGames = currentGames - (initial.games ?? 0);
    const games1v1 = current1v1 - (initial.initial_games_1v1 ?? 0);
    const games2v2 = current2v2 - (initial.initial_games_2v2 ?? 0);
    const games3v3 = current3v3 - (initial.initial_games_3v3 ?? 0);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎮 Jogos semanais - ${stats.name}`)
      .addFields(
        { name: 'Jogos totais (Casuais)', value: `\`${totalGames}\``, inline: false },
        { name: 'Ranked 1v1', value: `\`${games1v1}\``, inline: true },
        { name: 'Ranked 2v2', value: `\`${games2v2}\``, inline: true },
        { name: 'Ranked 3v3', value: `\`${games3v3}\``, inline: true }
      )
      .setFooter({
        text: `Dados contabilizados a partir de: ${formatCreatedAtBR(initial.created_at)}`
      });

    let components = [];

    if (isUserAdmin) {
      components = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prev_week`)
            .setLabel('Semana passada')
            .setStyle(ButtonStyle.Danger)
        )
      ];
    }

    const sentMessage = await sendCleanMessage(loadingMsg, {
      embeds: [embed],
      components
    });

    // Botão de semana passada (apenas para admins)
    if (isUserAdmin) {
      const filter = (i) => i.user.id === message.author.id;

      const collector = sentMessage.createMessageComponentCollector({
        filter,
        time: 60000,
        max: 1
      });

      collector.on('collect', async (interaction) => {
        try {
          await interaction.deferUpdate();

          const prev = new Date(weekStart);
          prev.setDate(prev.getDate() - 7);

          // Usa a data atual -7 dias, mas com o horário de 06:00:00
          const previousWeek = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')} 06:00:00`;

          const data = await getWeeklyInitial(brawlhallaId, previousWeek);

          if (!data) {
            return interaction.editReply({
              embeds: [createErrorEmbed('Erro', 'Dados da semana passada não encontrados')],
              components: []
            });
          }

          // Usa os dados atuais - os dados da semana passada para calcular os jogos da semana anterior
          const totalGamesPrev = (data.final_games ?? 0)   - (data.games ?? 0);
          const games1v1Prev   = (data.final_games_1v1 ?? 0) - (data.initial_games_1v1 ?? 0);
          const games2v2Prev   = (data.final_games_2v2 ?? 0) - (data.initial_games_2v2 ?? 0);
          const games3v3Prev   = (data.final_games_3v3 ?? 0) - (data.initial_games_3v3 ?? 0);
          const gainedXp       = (stats.clan?.personal_xp ?? 0) - (data.guild_xp ?? 0);

          const prevEmbed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(`🕓 Semana passada - ${stats.name}`)
            .addFields(
              { name: 'Jogos totais (Casuais)', value: `\`${totalGamesPrev}\``, inline: false },
              { name: 'Ranked 1v1', value: `\`${games1v1Prev}\``, inline: true },
              { name: 'Ranked 2v2', value: `\`${games2v2Prev}\``, inline: true },
              { name: 'Ranked 3v3', value: `\`${games3v3Prev}\``, inline: true },
              { name: 'XP da guilda', value: `\`${gainedXp}\``, inline: false }
            )
            .setFooter({
              text: `Semana iniciada em: ${formatCreatedAtBR(data.week_start)}`
            });

          await interaction.editReply({
            embeds: [prevEmbed],
            components: []
          });

        } catch (err) {
          console.error('Erro no botão:', err);
        }
      });
    }

  } catch (err) {
    console.error(err);

    const errorEmbed = createErrorEmbed('Erro', err.message);

    if (loadingMsg) {
      await sendCleanMessage(loadingMsg, { embeds: [errorEmbed] });
    } else {
      await message.reply({ embeds: [errorEmbed] });
    }
  }
}

// .clan
export async function handleClan(message, args, client) {
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

// .missoes
export async function handleMissoes(message, args, client) {
  try {
    const missions = await getWeeklyMissions();
    const weekEnd = getMissionWeekEnd();
    const now = new Date();

    if (!missions || missions.length === 0 || new Date(weekEnd) < now) {
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

// .active
export async function handleActive(message, args, client) {
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

// .birthday <DD/MM/YYYY>
export async function handleBirthday(message, args) {
  if (args.length === 0) {
    return message.reply({
      embeds: [createErrorEmbed('Uso incorreto', 'Use: `.birthday DD/MM/YYYY`')]
    });
  }

  const dateInput = args[0];
  const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const match = dateInput.match(dateRegex);

  if (!match) {
    return message.reply({
      embeds: [createErrorEmbed('Formato inválido', 'Use o formato: `DD/MM/YYYY` (exemplo: 25/12/2000)')]
    });
  }

  const [, day, month, year] = match;
  const birthdayISO = `${year}-${month}-${day}`;

  // Validar data
  const dateObj = new Date(birthdayISO);
  if (isNaN(dateObj.getTime())) {
    return message.reply({
      embeds: [createErrorEmbed('Data inválida', 'A data informada não é válida.')]
    });
  }

  try {
    // Verificar se já existe
    const existing = await getBirthdayByUserId(message.author.id);

    if (existing) {
      return message.reply({
        embeds: [createErrorEmbed('Aniversário já registrado', `Seu aniversário já está registrado para ${formatDateBR(existing.birthday)}.`)]
      });
    }

    // Inserir no banco
    await addBirthday(message.author.id, birthdayISO);

    return message.reply({
      embeds: [createSuccessEmbed(`Seu aniversário foi registrado: **${dateInput}**`)]
    });

  } catch (err) {
    console.error('[Birthday Error]', err);
    return message.reply({
      embeds: [createErrorEmbed('Erro ao registrar', 'Ocorreu um erro ao registrar seu aniversário. Tente novamente.')]
    });
  }
}