// public.js - Comandos públicos
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Events, PermissionFlagsBits, ChannelType } from 'discord.js';
import { removeInactivePlayer, getWeeklyMissions, getMissionWeekEnd, addMotd, getLastMotd, getBirthdayByUserId, addBirthday, formatCreatedAtBR, formatDateBR, getMissionWeekStartDateTime, getMonthWeekStartDateTime, getCurrentSeason, getSeasonWeekStartDateTime, getWeeklyInitial, loadAliases, resolveBrawlhallaId, corrigirID, incrementCrz, getUserByDiscordId, getContasVinculadas, getMemberJustifications } from './db.js';
import { getPlayerWeeklyGuildPoints } from './guild.js';
import { calcularDueloDaSemana, SEM_DUELO } from './services/dueloSemanal.js';
import { fetchPlayerStats, fetchClanStats, createStatsEmbed, createRankedEmbed, createGuildEmbed, getUserBrawlhallaId, getCached, fetchPlayerStatsNewAPI, fetchGuildStatsNewAPI, fetchPlayerGuildStatsNewAPI, fetchPlayerBasicNewAPI } from './brawlhalla.js';
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig, videoGuilda as videoGuildaConfig, justificativas as justificativasConfig, weeklyMvp as weeklyMvpConfig } from '../config/index.js';
import { criarPedidoDeBlindagem, decidirBlindagem, getBlindagem, getPedidoPendenteDoMembro, registrarMensagemDoPedido, MAX_SEMANAS, STATUS } from './inactivity.js';
import { calculateGames, calculateGamesFromClosedWeek, ORDENS_LB_GUILDA, POR_PAGINA_LB_GUILDA, ordenarLbGuilda, embedLbGuilda } from './handlers/publicHandlers.js';
import { calcularContribuicaoSemanal, MOTIVOS } from './services/contribuicaoSemanal.js';
import { CONTRIBUICAO_MINIMA } from './services/weeklyInactiveService.js';
import { selecionarMvpsDasLinhas, faltaParaMvp } from './services/weeklyMvpService.js';
import { QUIZ_REWARD } from './handlers/tggCoinsHandlers.js';
import { addTransaction, updateBalance } from './tggCoins.js';

import { createErrorEmbed, createSuccessEmbed, createLoadingEmbed, sendCleanMessage, createPagination } from '../utils/discordUtils.js';
import { isAdmin, adminOnly, channelOnly } from '../utils/permissions.js';
import { EMOJIS } from '../config/emojis.js';
import { SOCIALS } from '../config/socials.js';

// .help
export async function handleHelp(message, args, client) {
  const page1 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.crossedSwords} Guilda`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .missoes`, value: 'Mostrar as missões da semana atual', inline: false },
      { name: `${EMOJIS.arrowRight} .stats`, value: 'Trazer seus status atualizados do jogo', inline: false },
      { name: `${EMOJIS.arrowRight} .games`, value: 'Mostra a quantidade de jogos jogados durante a SEMANA', inline: false },
      { name: `${EMOJIS.arrowRight} .guild`, value: 'Ver informações da guilda Team TGG', inline: false },
      { name: `${EMOJIS.arrowRight} .duel`, value: 'Ver informações do duelo atual contra outra guilda', inline: false },
      { name: `${EMOJIS.arrowRight} .corrigir-id`, value: 'Caso esteja na guilda com alguma alt, pode vincular o id da sua conta principal', inline: false },
      { name: `${EMOJIS.arrowRight} .alts`, value: 'Ver suas contas alternativas vinculadas', inline: false },
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
      { name: `${EMOJIS.arrowRight} .refresh-cache`, value: 'Atualizar cache da guilda', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page3 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.clipboard} Informações`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .resumo`, value: 'Guia da guilda: semana, contribuição, missões, MVP, inatividade, coins e regras', inline: false },
      { name: `${EMOJIS.arrowRight} .regras`, value: 'Mostrar regras da guild', inline: false },
      { name: `${EMOJIS.arrowRight} .motd <mensagem>`, value: 'Salvar uma mensagem para ser sorteada (1x por semana)', inline: false },
      { name: `${EMOJIS.arrowRight} .birthday DD/MM`, value: 'Registrar seu aniversário para receber parabéns no dia!', inline: false },
      { name: `${EMOJIS.arrowRight} .redes`, value: 'Verificar as redes sociais da TGG', inline: false },
      { name: `${EMOJIS.arrowRight} .video-guilda (.explicacao)`, value: 'Vídeo explicando como funciona a guilda', inline: false },
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
      { name: `${EMOJIS.arrowRight} .wam <@user> [motivo]`, value: 'Warn falso (só pra brincar)', inline: false },
      { name: `${EMOJIS.arrowRight} .unwarn <@user> [número]`, value: 'Tirar um warn de um membro', inline: false },
      { name: `${EMOJIS.arrowRight} .warns`, value: 'Mostrar a listagem de todos os warns', inline: false },
      { name: `${EMOJIS.arrowRight} .mute <@user> <duração> [motivo]`, value: 'Silenciar um usuário por certo tempo', inline: false },
      { name: `${EMOJIS.arrowRight} .unmute <@user>`, value: 'Dessilenciar um usuário', inline: false },
      { name: `${EMOJIS.arrowRight} .ban <@user> [motivo]`, value: 'Banir um usuário do servidor (motivo é opcional)', inline: false },
      { name: `${EMOJIS.arrowRight} .bam <@user> [motivo]`, value: 'Ban falso (só pra brincar)', inline: false },
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
      { name: `${EMOJIS.arrowRight} .justificativas [@user]`, value: 'Listar todas as justificativas de um jogador inativo', inline: false },
      { name: `${EMOJIS.arrowRight} .scan [@user]`, value: 'Verificar informações gerais de um jogador inativo', inline: false },
      { name: `${EMOJIS.arrowRight} .inativar`, value: 'Inativar jogadores inativos da semana', inline: false },
      { name: `${EMOJIS.arrowRight} .blindagem <justificativa> <quantidade de semanas>`, value: 'Blindar um jogador por um período de semanas', inline: false },
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
      { name: `${EMOJIS.arrowRight} .add-account <id>`, value: 'Cadastrar uma alt para trackear as conquistas entre elas', inline: false },
      { name: `${EMOJIS.arrowRight} .balance (.bal)`, value: 'Ver a quantidade atual de moedas que você tem', inline: false },
      { name: `${EMOJIS.arrowRight} .historico (.hist)`, value: 'Ver seu histórico de gastos', inline: false },
      { name: `${EMOJIS.arrowRight} .leaderboard (.lb)`, value: 'Ver um leaderboard com as pessoas que mais tem TGG-Coins', inline: false },
      { name: `${EMOJIS.arrowRight} .quiz`, value: 'Responder um quiz sobre como funcionam as coisas na guilda', inline: false },
      { name: `${EMOJIS.arrowRight} .shop`, value: 'Ver a loja de itens', inline: false },
      { name: `${EMOJIS.arrowRight} .buy <número do item>`, value: 'Fazer uma compra de um item da loja (usar o número que aparece ao lado do item)', inline: false },
      { name: `${EMOJIS.arrowRight} .inventory (.inv)`, value: 'Equipar e/ou trocar suas cores no servidor', inline: false },
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const page8 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.ticketGuild} Tickets`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .abrir-tickets`, value: 'Abrir os tickets para entrar na guilda e mandar mensagem', inline: false },
      { name: `${EMOJIS.arrowRight} .fechar-tickets`, value: 'Fechar os tickets para entrar na guilda e mandar mensagem', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no dropdown' })
    .setTimestamp();

  const isUserAdmin = await isAdmin(message.author.id);

  const options = [
    { label: 'Guilda', value: 'guild', emoji: EMOJIS.crossedSwords, description: 'Comandos da guilda' },
    { label: 'Informações', value: 'info', emoji: EMOJIS.clipboard, description: 'Comandos de informação' },
    { label: 'TGG Coins', value: 'tggcoins', emoji: EMOJIS.TGGcoin, description: 'Comandos TGG Coins' }
  ];

  // Páginas exclusivas para admins
  if (isUserAdmin) {
    options.push(
      { label: 'Sincronização (admin).', value: 'sync', emoji: EMOJIS.hourglass, description: 'Comandos de sincronização' },
      { label: 'Gerenciamento (admin).', value: 'users', emoji: EMOJIS.success, description: 'Gerenciamento de usuários' },
      { label: 'Inativos (admin).', value: 'inac', emoji: EMOJIS.xis, description: 'Comandos de inatividade' },
      { label: 'Missões (admin).', value: 'missions', emoji: EMOJIS.scroll, description: 'Comandos para missões' },
      { label: 'Tickets (admin).', value: 'tickets', emoji: EMOJIS.ticketGuild, description: 'Tickets para entrar na guilda' }
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
      if (selected === 'tickets') embedToShow = page8;
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

// Quanto vale mandar uma mensagem para o sorteio da MOTD
const MOTD_REWARD = 100;

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

    await addMotd(message.author.id, message.member.displayName, motdMessage);

    // Recompensa pela participação. A trava de 7 dias acima é o que limita o ganho: uma MOTD por
    // membro por semana. Falha aqui não pode derrubar o comando - a mensagem já foi salva.
    let recompensa = null;

    try {
      await addTransaction(message.author.id, MOTD_REWARD, 'MOTD', 'Mensagem do dia enviada');
      const novoSaldo = await updateBalance(message.author.id, MOTD_REWARD);

      recompensa = `${EMOJIS.TGGcoin} +${MOTD_REWARD} TGG Coins\n💳 Saldo atual: **${novoSaldo.toLocaleString('pt-BR')}**`;
    } catch (err) {
      console.warn('[MOTD] Nao foi possivel creditar as TGG Coins:', err.message);
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('📢 Mensagem do Dia')
      .setDescription('Sua mensagem foi salva com sucesso e será sorteada em breve!')
      .addFields({ name: 'Mensagem', value: `"${motdMessage}"` })
      .setFooter({ text: 'TGG Bot • MOTD' })
      .setTimestamp();

    if (recompensa) {
      embed.addFields({ name: 'Recompensa', value: recompensa });
    }

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

    const loadingMsg = await message.reply({ embeds: [createLoadingEmbed(`${EMOJIS.loading} Carregando estatísticas...`, 'Buscando dados do Brawlhalla...')] });
    const playerData = await fetchPlayerStats(brawlhallaId);

    // Pegar os guild points e mandar pro stats. O id aqui é o cadastrado, sem resolver: é a conta
    // que está no clã, e é dela que saem pontos, posição e histórico. O `playerData` veio do
    // `fetchPlayerStats`, que resolve alt, então o `brawlhalla_id` de dentro dele é outro — daí
    // mandar `guildAccountId` junto, senão o embed mistura as duas contas no Weekly GP.
    const guildPoints = await fetchPlayerGuildStatsNewAPI(brawlhallaId);
    playerData.guildPoints = guildPoints?.personal_points || 0;
    playerData.guildAccountId = String(brawlhallaId);
    playerData.weeklyGuildPosition = await posicaoContribuicaoSemanal(brawlhallaId);

    const mainEmbed = await createStatsEmbed(playerData);
    const rankedEmbed = createRankedEmbed(playerData);
    const legendsEmbed = (await import('./brawlhalla.js')).createLegendsStatsEmbed(playerData);
    const weaponsEmbed = (await import('./brawlhalla.js')).createWeaponsStatsEmbed(playerData);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('stats_main').setLabel('Geral').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stats_ranked').setLabel('Ranked').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stats_legends').setLabel('Legends').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stats_weapons').setLabel('Weapons').setStyle(ButtonStyle.Primary)
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
        } else if (i.customId === 'stats_weapons') {
          await i.update({ embeds: [weaponsEmbed], components: [row] }).catch(() => { });
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
        embeds: [createErrorEmbed('Acesso negado', 'Você só pode ver seus próprios dados.')]
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

    loadingMsg = await message.reply({ embeds: [createLoadingEmbed('Carregando...', 'Buscando dados semanais...')] });

    const weekStart = getMissionWeekStartDateTime();
    const initial = await getWeeklyInitial(brawlhallaId, weekStart);

    if (!initial) {
      return await sendCleanMessage(loadingMsg, {
        embeds: [createErrorEmbed('Erro', 'Dados semanais não encontrados')]
      });
    }

    const stats = await fetchPlayerStats(brawlhallaId);
    const ranked = stats.ranked;

    // Mesma função que os botões e o `.scan` usam; a cópia inline que existia aqui saiu de sincronia
    const { totalGames, casualGames, games1v1, games2v2, games3v3 } = calculateGames(stats, ranked, initial);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎮 Jogos semanais - ${stats.name}`)
      .addFields(
        { name: 'Jogos Totais', value: `\`${totalGames}\``, inline: true }, 
        { name: 'Jogos Casuais', value: `\`${casualGames}\``, inline: true }, 
        { name: '\u200B', value: '\u200B', inline: true }, // espaço pra fechar a linha
        { name: 'Ranked 1v1', value: `\`${games1v1}\``, inline: true },
        { name: 'Ranked 2v2', value: `\`${games2v2}\``, inline: true },
        { name: 'Ranked 3v3', value: `\`${games3v3}\``, inline: true }
      )
      .setFooter({
        text: `Dados contabilizados a partir de: ${formatCreatedAtBR(initial.created_at)}`
      });

    let components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('games_week')
          .setLabel('Semanal')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId('games_month')
          .setLabel('Mensal')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('games_season')
          .setLabel('Season')
          .setStyle(ButtonStyle.Success)
      )
    ];

    if (isUserAdmin) {
      components[0].addComponents(
        new ButtonBuilder()
          .setCustomId('prev_week')
          .setLabel('Semana passada')
          .setStyle(ButtonStyle.Danger)
      );
    }

    const sentMessage = await sendCleanMessage(loadingMsg, {
      embeds: [embed],
      components
    });

    const filter = (i) => i.user.id === message.author.id;

    const collector = sentMessage.createMessageComponentCollector({
      filter,
      time: 60000
    });

    collector.on('collect', async (interaction) => {
      try {
        await interaction.deferUpdate();

        let weekStart;
        let title;

        // Se clicou no botão de semana passada, precisa calcular a data da semana passada e buscar os dados a partir dela
        if (interaction.customId === 'prev_week') {
          const prev = new Date(getMissionWeekStartDateTime());
          prev.setDate(prev.getDate() - 7);

          // Usa a data atual -7 dias, mas com o horário de 06:00:00
          const previousWeek = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')} 06:00:00`;
          
          const data = await getWeeklyInitial(brawlhallaId, previousWeek);

          if (!data) {
            return interaction.editReply({
              embeds: [createErrorEmbed('Erro', 'Dados da semana passada não encontrados')]
            });
          }

          // Fecha a semana pelos campos final_*, com a mesma composição da semana atual
          const prevResult = calculateGamesFromClosedWeek(data);
          const gainedXp = (stats.clan?.personal_xp ?? 0) - (data.guild_xp ?? 0);

          const prevEmbed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(`🕓 Semana passada - ${stats.name}`)
            .addFields(
              { name: 'Jogos Totais', value: `\`${prevResult.totalGames}\``, inline: true },
              { name: 'Jogos Casuais', value: `\`${prevResult.casualGames}\``, inline: true },
              { name: '​', value: '​', inline: true }, // espaço pra fechar a linha
              { name: 'Ranked 1v1', value: `\`${prevResult.games1v1}\``, inline: true },
              { name: 'Ranked 2v2', value: `\`${prevResult.games2v2}\``, inline: true },
              { name: 'Ranked 3v3', value: `\`${prevResult.games3v3}\``, inline: true },
              { name: 'XP da guilda', value: `\`${gainedXp}\``, inline: false }
            )
            .setFooter({
              text: `Semana iniciada em: ${formatCreatedAtBR(data.week_start)}`
            });

          return interaction.editReply({
            embeds: [prevEmbed],
            components
          });
        }

        // Para o botão "Semana", compara os dados atuais com os dados do início da semana atual
        if (interaction.customId === 'games_week') {
          weekStart = getMissionWeekStartDateTime();
          title = '🎮 Jogos semanais';
        }

        // Para o botão "Mês", compara os dados atuais com os dados da primeira quinta-feira do mês atual
        if (interaction.customId === 'games_month') {
          weekStart = getMonthWeekStartDateTime();
          title = '🗓️ Jogos mensais';
        }

        // Para o botão "Season", compara os dados atuais com os dados do início da season (se tiver algum dado)
        if (interaction.customId === 'games_season') {
          const season = await getCurrentSeason();
          weekStart = getSeasonWeekStartDateTime(season.started_at);
          title = `🏆 Season ${season.season}`;
        }

        const initial = await getWeeklyInitial(brawlhallaId, weekStart);

        if (!initial) {
          return interaction.editReply({
            embeds: [createErrorEmbed('Sem dados', `Não existe um registro gravado para ${formatDateBR(weekStart)}.`)]
          });
        }

        const result = calculateGames(stats, ranked, initial);

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${title} - ${stats.name}`)
          .addFields(
            { name: 'Jogos Totais', value: `\`${result.totalGames}\``, inline: true },
            { name: 'Jogos Casuais', value: `\`${result.casualGames}\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Ranked 1v1', value: `\`${result.games1v1}\``, inline: true },
            { name: 'Ranked 2v2', value: `\`${result.games2v2}\``, inline: true },
            { name: 'Ranked 3v3', value: `\`${result.games3v3}\``, inline: true }
          )
          .setFooter({
            text: `Dados contabilizados a partir de: ${formatCreatedAtBR(initial.created_at)}`
          });

        await interaction.editReply({
          embeds: [embed],
          components
        });

      } catch (err) {
        console.error('Erro no botão:', err);
      }
    });
    

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

/**
 * Ranking de contribuição da semana corrente, do maior para o menor.
 *
 * Vem de [contribuicaoSemanal.js](./services/contribuicaoSemanal.js), o mesmo cálculo do MVP e da
 * inativação - as rotinas precisam concordar sobre quem contribuiu quanto. Quem não pôde ser medido
 * (`motivo` preenchido) fica de fora: 0 e "não sei" são coisas diferentes.
 *
 * Devolve `null` quando o cálculo falha, para o comando seguir sem o ranking em vez de quebrar.
 */
async function topContribuintesDaSemana(limite) {
  try {
    const { linhas } = await calcularContribuicaoSemanal();

    return linhas
      .filter((l) => !l.motivo && l.contribuicao > 0)
      .sort((a, b) => b.contribuicao - a.contribuicao || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, limite);

  } catch (err) {
    console.warn('[Contribuição] Ranking semanal indisponível:', err.message);
    return null;
  }
}

/**
 * Posição do jogador no ranking de contribuição da semana, para o `.stats`.
 *
 * Sai da mesma medida do MVP e da inativação (`calcularContribuicaoSemanal`) em vez de uma conta
 * própria — três definições diferentes de "contribuição da semana" seria uma a mais do que já é
 * confuso. Só entram no ranking os membros que puderam ser medidos: quem tem `motivo` não tem
 * número, e enfiá-lo como 0 empurraria todo mundo para baixo.
 *
 * Empate divide a mesma posição (dois com 500 são ambos 3º, e o próximo é 5º) — sem isso a ordem
 * entre os empatados seria arbitrária, e empate em 0 é o caso mais comum da lista.
 */
async function posicaoContribuicaoSemanal(brawlhallaId) {
  try {
    const { linhas } = await calcularContribuicaoSemanal();

    const eu = linhas.find((l) => String(l.brawlhallaId) === String(brawlhallaId));
    if (!eu || eu.motivo) return null;

    const acima = linhas.filter((l) => !l.motivo && l.contribuicao > eu.contribuicao).length;

    return acima + 1;

  } catch (err) {
    // Posição é enfeite: sem ela o embed ainda mostra o valor da contribuição
    console.warn('[Contribuição] Posição semanal indisponível:', err.message);
    return null;
  }
}

// .guild
export async function handleGuild(message, args, client) {
  // Declarado fora do try: o catch precisa alcançar a mensagem de loading para editá-la
  let loadingMsg = null;

  try {
    const NOSSA_GUILDA = process.env.BRAWLHALLA_CLAN_ID || '396943';

    let GuildId = NOSSA_GUILDA;
    if (args.length > 0 && /^\d+$/.test(args[0])) {
      GuildId = args[0];
    }

    // Contribuição da semana só existe para a nossa guilda - a linha de base é dos nossos membros
    const topSemanal = GuildId === NOSSA_GUILDA ? await topContribuintesDaSemana(10) : null;

    // Cache quente evita a mensagem de loading. A chave é a mesma que fetchGuildStatsNewAPI grava:
    // `clan:` é da rota v0 depreciada e tem outro formato (clan_id/clan_name), que chegava aqui sem
    // guild_id e fazia a busca de membros ir para a API com 'N/A'. Sem ignoreTtl: fora dos 5 min a
    // busca normal roda de novo, e ela mesma cai no cache velho se a API estiver fora.
    const cachedData = getCached(`guild:${GuildId}`);
    if (cachedData) {
      return await message.reply({ embeds: [await createGuildEmbed(cachedData, topSemanal)] });
    }

    loadingMsg = await message.reply({ embeds: [createLoadingEmbed(`${EMOJIS.loading} Carregando informações da guilda...`, 'Buscando dados do Brawlhalla...')] });
    const guildData = await fetchGuildStatsNewAPI(GuildId);
    await sendCleanMessage(loadingMsg, { embeds: [await createGuildEmbed(guildData, topSemanal)] });

  } catch (err) {
    console.error('Error fetching guild stats:', err);
    const errorEmbed = createErrorEmbed('Erro ao Buscar Estatísticas da guilda', err.message);
    if (loadingMsg) {
      await sendCleanMessage(loadingMsg, { embeds: [errorEmbed] }).catch(() => { });
    } else {
      await message.reply({ embeds: [errorEmbed] }).catch(() => { });
    }
  }
}

// .lb-guilda [total|semanal]
export async function handleLbGuilda(message, args) {
  // Abre na semana: é o número que decide MVP e inativação, e o que o membro vem conferir. O total
  // é acumulado de meses e quase não muda de um dia para o outro.
  let ordem = ORDENS_LB_GUILDA.SEMANAL;

  const pedida = message.interaction
    ? message.interaction.options.getString('ordem')
    : String(args?.[0] || '').toLowerCase();

  if (['total', 'totais', 'geral', 'tudo'].includes(String(pedida || '').toLowerCase())) {
    ordem = ORDENS_LB_GUILDA.TOTAL;
  }

  
  // Mesma função que decide a inativação na quarta, de propósito: o número que o membro lê aqui é
  // o que vai valer lá. Uma leitura serve as duas ordenações e todas as páginas — trocar de aba ou
  // virar página não volta na API. Fica só quem tem cadastro no bot **e** está na guilda do jogo.
  const { weekStart, linhas: todas } = await calcularContribuicaoSemanal();
  const linhas = todas.filter(l => l.motivo !== MOTIVOS.FORA_DA_GUILDA);

  if (!linhas.length) {
    return message.reply({
      embeds: [createErrorEmbed('Leaderboard vazio', 'Nenhum membro cadastrado foi encontrado na guilda do jogo.')]
    });
  }

  // Mesma regra do cron de quarta 06:00, aplicada às linhas que já estão na mão: staff entra sem
  // ocupar vaga e a lista fecha na 14ª vaga preenchida. É prévia — quem está marcado leva o cargo
  // se a semana fechar agora.
  const { ranking, mvps } = selecionarMvpsDasLinhas(linhas);
  const mvpPorId = new Map(mvps.map(m => [m.discordId, { posicao: m.posicao }]));

  // Quem chamou o comando, para o bloco do topo. A distância até o corte sai da mesma regra que
  // seleciona os MVPs — calcular aqui faria o "faltam X" discordar do 🏅 logo abaixo.
  const eu = linhas.find(l => l.discordId === String(message.author.id)) || null;
  const falta = eu ? faltaParaMvp(ranking, mvps, message.author.id) : null;

  const posicaoNaLista = (lista) => {
    const i = eu ? lista.findIndex(l => l.discordId === eu.discordId) : -1;
    return i >= 0 ? i + 1 : null;
  };

  const totalPaginas = () => Math.ceil(linhas.length / POR_PAGINA_LB_GUILDA) || 1;

  // Ordena uma vez por ordenação, não a cada página
  const cache = new Map();
  const ordenadas = () => {
    if (!cache.has(ordem)) cache.set(ordem, ordenarLbGuilda(linhas, ordem));
    return cache.get(ordem);
  };

  await createPagination(message, {
    getEmbed: (pagina) => embedLbGuilda({
      linhas: ordenadas(),
      pagina,
      ordem,
      weekStart,
      totalPaginas: totalPaginas(),
      mvpPorId,
      destaque: {
        linha: eu,
        posicao: posicaoNaLista(ordenadas()),
        mvp: eu ? mvpPorId.get(eu.discordId) : null,
        falta,
      },
    }),
    getTotalPages: totalPaginas,
    // 14 páginas não se percorrem nos 60s do padrão; `idle` reinicia a cada clique
    idle: 3 * 60 * 1000,
    time: 15 * 60 * 1000,
    prevId: 'prev_lbguilda',
    nextId: 'next_lbguilda',
    extraButtons: () => [
      new ButtonBuilder()
        .setCustomId('toggle_ordem_lbguilda')
        .setLabel(ordem === ORDENS_LB_GUILDA.SEMANAL ? 'Ver Totais' : 'Ver da Semana')
        .setEmoji(ordem === ORDENS_LB_GUILDA.SEMANAL ? '🏛️' : '📈')
        .setStyle(ButtonStyle.Secondary),
    ],
    onExtra: async (interaction) => {
      if (interaction.customId === 'toggle_ordem_lbguilda') {
        ordem = ordem === ORDENS_LB_GUILDA.SEMANAL ? ORDENS_LB_GUILDA.TOTAL : ORDENS_LB_GUILDA.SEMANAL;
        return 1;
      }
    },
  });
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

// .active - preso ao canal de players inativos, que é onde o lembrete pede a ativação
export const handleActive = channelOnly(inactivePlayersConfig.channelId, async (message, args, client) => {
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
});

// Rótulos dos motivos de "não deu para medir", no mesmo vocabulário do cálculo semanal
const MOTIVO_CONTRIBUICAO = {
  [MOTIVOS.FORA_DA_GUILDA]: 'Fora da guilda no jogo',
  [MOTIVOS.SEM_BASE]: 'Sem base gravada nesta semana',
  [MOTIVOS.BASE_ZERADA]: 'Base zerada - não dá para medir',
};

const JUSTIFICATIVAS_POR_PAGINA = 5;

/**
 * Dossiê do pedido de blindagem: o que a staff precisa para decidir sem sair do canal.
 *
 * A contribuição sai de `calcularContribuicaoSemanal()` de propósito - é o mesmo número que
 * decide a inativação na quarta, então o que a staff lê aqui é o que vai valer lá. As duas outras
 * medidas seguem a divisão do `.scan`: jogos são da conta principal (`alt_ids`), contribuição e
 * justificativas são da conta que está na guilda.
 *
 * Nenhuma fonte aqui pode derrubar o pedido - o que falhar vira "indisponível" no embed.
 */
async function reunirDossie(brawlhallaId) {
  const vazio = {
    contribuicao: null,
    motivoContribuicao: 'Sem Brawlhalla ID cadastrado',
    jogosTotais: null,
    jogosDaSemana: null,
    justificativas: [],
  };

  if (!brawlhallaId) return vazio;

  const conta = String(brawlhallaId);

  await loadAliases().catch(() => {});
  const idJogo = resolveBrawlhallaId(conta);
  const weekStart = getMissionWeekStartDateTime();

  const [semanal, justificativas, stats, baseDaSemana] = await Promise.all([
    calcularContribuicaoSemanal().catch((err) => {
      console.warn('[JUSTIFICATIVA] contribuição indisponível:', err.message);
      return null;
    }),
    getMemberJustifications(conta).catch((err) => {
      console.warn('[JUSTIFICATIVA] justificativas indisponíveis:', err.message);
      return [];
    }),
    fetchPlayerStats(idJogo).catch((err) => {
      console.warn(`[JUSTIFICATIVA] stats indisponíveis para ${idJogo}:`, err.message);
      return null;
    }),
    getWeeklyInitial(idJogo, weekStart).catch(() => null),
  ]);

  const linha = semanal?.linhas.find((l) => l.brawlhallaId === conta) ?? null;

  let motivoContribuicao = 'Indisponível (API fora do ar)';
  if (linha?.motivo) motivoContribuicao = MOTIVO_CONTRIBUICAO[linha.motivo] ?? linha.motivo;
  else if (semanal && !linha) motivoContribuicao = 'Conta fora do cálculo da semana';

  return {
    contribuicao: linha && !linha.motivo ? linha.contribuicao : null,
    motivoContribuicao,
    jogosTotais: stats?.games ?? null,
    jogosDaSemana: stats && baseDaSemana ? calculateGames(stats, stats.ranked, baseDaSemana).totalGames : null,
    justificativas: justificativas ?? [],
  };
}

/** Os três campos do dossiê que entram no embed do pedido. */
function camposDoDossie({ contribuicao, motivoContribuicao, jogosTotais, jogosDaSemana, justificativas }) {
  const comNota = justificativas.filter((j) => j.note).length;
  const ultima = justificativas[0];

  const contribuicaoTexto = contribuicao == null
    ? motivoContribuicao
    : contribuicao >= CONTRIBUICAO_MINIMA
      ? `✅ **${contribuicao.toLocaleString('pt-BR')}** de ${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')}`
      : `**${contribuicao.toLocaleString('pt-BR')}** de ${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')} ` +
        `- faltam **${(CONTRIBUICAO_MINIMA - contribuicao).toLocaleString('pt-BR')}**`;

  const jogosTexto = [
    jogosTotais != null ? `**${jogosTotais.toLocaleString('pt-BR')}** no total` : 'Total indisponível',
    jogosDaSemana != null ? `**${jogosDaSemana.toLocaleString('pt-BR')}** nesta semana` : null,
  ].filter(Boolean).join('\n');

  const historicoTexto = justificativas.length
    ? `**${justificativas.length}** semana(s) na lista de inativos • **${comNota}** justificada(s)` +
      (ultima?.week_reference ? `\nÚltima: semana de ${formatDateBR(ultima.week_reference)}` : '')
    : 'Nunca foi marcado como inativo';

  return [
    { name: '🎯 Contribuição desta semana', value: contribuicaoTexto, inline: true },
    { name: '🎮 Jogos', value: jogosTexto, inline: true },
    { name: '📋 Histórico de inatividade', value: historicoTexto, inline: false },
  ];
}

// .justificativa <motivo> <semanas>
export async function handleJustificativa(message, args, client) {
  let aguarde = null;

  try {
    let motivo;
    let semanas;

    // No caminho slash as opções vêm tipadas; no prefixo, a última palavra é o número
    if (message.interaction) {
      motivo = message.interaction.options.getString('justificativa')?.trim() ?? '';
      semanas = message.interaction.options.getInteger('semanas');

    } else {
      const ultimo = args[args.length - 1];
      semanas = /^\d+$/.test(ultimo ?? '') ? Number(ultimo) : NaN;
      motivo = args.slice(0, -1).join(' ').trim();
    }

    if (!Number.isInteger(semanas) || semanas < 1 || semanas > MAX_SEMANAS) {
      return message.reply({
        embeds: [createErrorEmbed(
          'Uso incorreto',
          `Use: \`.justificativa <motivo> <semanas>\`\n\n` +
          `A quantidade de semanas vai por último, de **1 a ${MAX_SEMANAS}**.\n` +
          `Ex.: \`.justificativa Vou viajar e fico sem PC 2\``
        )]
      });
    }

    if (motivo.length < 15) {
      return message.reply({
        embeds: [createErrorEmbed(
          'Justificativa muito curta',
          'Explique o motivo com **pelo menos 15 caracteres** - quem lê precisa entender o que houve.'
        )]
      });
    }

    const user = await getUserByDiscordId(message.author.id);

    if (!user || !user.active) {
      return message.reply({
        embeds: [createErrorEmbed(
          'Sem Cadastro',
          'Só membros ativos da guilda podem pedir blindagem.'
        )]
      });
    }

    const pendente = await getPedidoPendenteDoMembro(message.author.id);

    if (pendente) {
      return message.reply({
        embeds: [createErrorEmbed(
          'Você já tem um pedido em análise',
          'Espere a staff decidir o pedido anterior antes de mandar outro.'
        )]
      });
    }

    const canal = justificativasConfig.channelId
      ? await client.channels.fetch(justificativasConfig.channelId).catch(() => null)
      : null;

    // Sem canal não há como alguém aprovar, e o pedido ficaria pendente para sempre
    if (!canal) {
      return message.reply({
        embeds: [createErrorEmbed(
          'Canal da staff indisponível',
          'Não consegui enviar seu pedido para análise. Avise um administrador.'
        )]
      });
    }

    // O dossiê passa pela API e pelo cálculo da semana inteira, então demora alguns segundos
    aguarde = await message.reply({
      embeds: [createLoadingEmbed('Enviando para a staff...', `${EMOJIS.loading} Juntando seus dados da semana.`)]
    });

    const pedido = await criarPedidoDeBlindagem({
      discordId: message.author.id,
      reason: motivo,
      weeks: semanas,
    });

    // Junta contribuição, jogos e histórico do membro para a staff não precisar rodar `.scan`
    const dossie = await reunirDossie(user.brawlhalla_id);

    const [ano, mes, dia] = String(pedido.week_start).slice(0, 10).split('-');

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle('📝 Pedido de justificativa')
      .setDescription(`<@${message.author.id}> pediu blindagem contra inativação.`)
      .addFields(
        { name: 'Motivo', value: motivo.slice(0, 1024), inline: false },
        { name: 'Semanas', value: `**${semanas}**`, inline: true },
        // A semana de inatividade corre de quarta a quarta; a blindagem vale a partir da que
        // está em curso, então a data costuma ser alguns dias atrás.
        { name: 'A partir da semana de', value: `${dia}/${mes}/${ano}`, inline: true },
        ...camposDoDossie(dossie),
      )
      .setFooter({ text: 'Aprovar blinda o membro; recusar avisa que não foi aceita.' })
      .setTimestamp();

    const botoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`justificativa_aprovar_${pedido.id}`)
        .setLabel('Aprovar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`justificativa_recusar_${pedido.id}`)
        .setLabel('Recusar')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`justificativa_hist_${pedido.id}`)
        .setLabel(`📋 Justificativas (${dossie.justificativas.length})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!dossie.justificativas.length),
    );

    // O canal é só de staff, então pingar todo mundo é o jeito de a decisão não ficar parada —
    // pedido pendente não protege ninguém e a semana fecha na quarta.
    const aviso = await canal.send({
      content: '@everyone',
      embeds: [embed],
      components: [botoes],
      allowedMentions: { parse: ['everyone'] },
    });

    await registrarMensagemDoPedido(pedido.id, aviso.channelId, aviso.id);

    await sendCleanMessage(aguarde, {
      embeds: [createSuccessEmbed(
        'Justificativa enviada',
        `Seu pedido de **${semanas} semana(s)** foi mandado para a staff analisar.\n\n` +
        `Você recebe uma DM assim que alguém decidir. Enquanto isso o pedido **não** blinda ` +
        `- se a semana fechar sem decisão, você ainda pode cair na lista de inativos.`
      )]
    });

  } catch (err) {
    const erro = createErrorEmbed('Erro ao Enviar Justificativa', err.message);

    if (aguarde) await sendCleanMessage(aguarde, { embeds: [erro] });
    else await message.reply({ embeds: [erro] });
  }
}

/** Página do histórico de inatividade - mesmo formato da aba "Justificativas" do `.scan`. */
function embedHistoricoDeJustificativas(justificativas, pagina, discordId) {
  const totalPaginas = Math.max(1, Math.ceil(justificativas.length / JUSTIFICATIVAS_POR_PAGINA));
  const inicio = pagina * JUSTIFICATIVAS_POR_PAGINA;
  const itens = justificativas.slice(inicio, inicio + JUSTIFICATIVAS_POR_PAGINA);
  const comNota = justificativas.filter((j) => j.note).length;

  const descricao = itens
    .map((item, i) => {
      const quando = item.created_at ? formatDateBR(item.created_at) : '-';
      const semana = item.week_reference ? formatDateBR(item.week_reference) : '-';
      const texto = item.note || '_semana sem justificativa_';
      return `**${inicio + i + 1}.** 🗓️ semana de ${semana} • 🕒 ${quando}\n${texto}`;
    })
    .join('\n\n');

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('📋 Histórico de justificativas')
    .setDescription(`<@${discordId}>\n\n${descricao}`)
    .setFooter({
      text: `${comNota} justificada(s) de ${justificativas.length} semana(s) inativo • página ${pagina + 1}/${totalPaginas}`
    });
}

/**
 * Aba de justificativas do pedido de blindagem, aberta pelo botão do embed.
 *
 * Efêmera e sem collector, pelo mesmo motivo dos botões de decisão: a mensagem do pedido fica
 * viva por horas e precisa sobreviver a restart. A página vai no próprio `customId`
 * (`justificativa_histpg_<pedido>_<página>`), então cada clique é uma consulta nova e nada
 * depende de estado em memória.
 */
export async function handleJustificativaHistorico(interaction) {
  const partes = interaction.customId.split('_');
  const abrindo = partes[1] === 'hist';
  const pedidoId = partes[2];
  const pagina = abrindo ? 0 : Math.max(0, Number(partes[3]) || 0);

  if (!(await isAdmin(interaction.user.id))) {
    return interaction.reply({
      embeds: [createErrorEmbed('Acesso Negado', 'Apenas officers e administradores veem o histórico.')],
      ephemeral: true,
    }).catch(() => {});
  }

  if (abrindo) await interaction.deferReply({ ephemeral: true }).catch(() => {});

  const pedido = await getBlindagem(pedidoId).catch(() => null);
  const user = pedido ? await getUserByDiscordId(pedido.discord_id).catch(() => null) : null;

  const responder = (payload) => (abrindo
    ? interaction.editReply(payload)
    : interaction.update(payload)).catch(() => {});

  if (!user?.brawlhalla_id) {
    return responder({
      embeds: [createErrorEmbed(
        'Sem histórico',
        pedido ? 'O autor do pedido não tem Brawlhalla ID cadastrado.' : 'Não encontrei este pedido.'
      )],
      components: [],
    });
  }

  const justificativas = await getMemberJustifications(String(user.brawlhalla_id)).catch(() => []);

  if (!justificativas.length) {
    return responder({
      embeds: [new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle('📋 Histórico de justificativas')
        .setDescription(`<@${pedido.discord_id}> nunca foi marcado como inativo.`)],
      components: [],
    });
  }

  const totalPaginas = Math.ceil(justificativas.length / JUSTIFICATIVAS_POR_PAGINA);
  const atual = Math.min(pagina, totalPaginas - 1);

  const componentes = totalPaginas > 1
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`justificativa_histpg_${pedidoId}_${atual - 1}`)
          .setLabel('⬅️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(atual === 0),
        new ButtonBuilder()
          .setCustomId(`justificativa_histpg_${pedidoId}_${atual + 1}`)
          .setLabel('➡️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(atual >= totalPaginas - 1),
      )]
    : [];

  return responder({
    embeds: [embedHistoricoDeJustificativas(justificativas, atual, pedido.discord_id)],
    components: componentes,
  });
}

/**
 * Botões do pedido de justificativa, roteados por prefixo em [interactions.js](./interactions.js).
 *
 * Não dá para usar collector aqui: a staff pode demorar horas para decidir e o collector morre no
 * primeiro restart. O estado vive na tabela, então o botão continua funcionando depois de deploy.
 */
export async function handleJustificativaButton(interaction, client) {
  const [, acao, id] = interaction.customId.split('_');

  // Reconhece antes de qualquer consulta: são até três idas ao banco até a resposta, e o token
  // do botão vale 3s. Sem isso a decisão era gravada e a staff via "Esta interação falhou".
  await interaction.deferUpdate().catch(err => {
    console.warn(`[JUSTIFICATIVA] deferUpdate falhou: ${err.message}`);
  });

  if (!(await isAdmin(interaction.user.id))) {
    return interaction.followUp({
      embeds: [createErrorEmbed('Acesso Negado', 'Apenas officers e administradores decidem justificativas.')],
      ephemeral: true,
    }).catch(() => {});
  }

  const aprovar = acao === 'aprovar';
  const status = aprovar ? STATUS.APROVADA : STATUS.RECUSADA;

  // O update condicionado a status = pendente resolve dois cliques ao mesmo tempo: o segundo
  // não encontra linha e sai sem sobrescrever a decisão do primeiro.
  const pedido = await decidirBlindagem(id, { status, approvedBy: interaction.user.id });

  if (!pedido) {
    const atual = await getBlindagem(id).catch(() => null);

    return interaction.followUp({
      embeds: [createErrorEmbed(
        'Já decidido',
        atual?.approved_by
          ? `Este pedido já foi **${atual.status}** por <@${atual.approved_by}>.`
          : 'Este pedido não está mais pendente.'
      )],
      ephemeral: true,
    }).catch(() => {});
  }

  const embedDecidido = new EmbedBuilder()
    .setColor(aprovar ? 0x57f287 : 0xed4245)
    .setTitle(aprovar ? '✅ Justificativa aprovada' : '❌ Justificativa recusada')
    .setDescription(`Pedido de <@${pedido.discord_id}>, decidido por <@${interaction.user.id}>.`)
    .addFields(
      { name: 'Motivo', value: String(pedido.reason).slice(0, 1024), inline: false },
      { name: 'Semanas', value: `**${pedido.weeks}**`, inline: true },
      {
        name: aprovar ? 'Blindado a partir da semana de' : 'Efeito',
        value: aprovar
          ? String(pedido.week_start).slice(0, 10).split('-').reverse().join('/')
          : 'Nenhum - o membro segue sujeito à inativação.',
        inline: true,
      },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embedDecidido], components: [] }).catch(() => {});

  const dm = new EmbedBuilder()
    .setColor(aprovar ? 0x57f287 : 0xed4245)
    .setTitle(aprovar ? '✅ Justificativa aceita' : '❌ Justificativa não aceita')
    .setDescription(
      aprovar
        ? `Sua justificativa foi aceita: você **não será inativado** pelas próximas ` +
          `**${pedido.weeks} semana(s)**.\n\n_Motivo registrado: ${pedido.reason}_`
        : `Sua justificativa **não foi aceita** pela staff.\n\n_Motivo enviado: ${pedido.reason}_\n\n` +
          `Você continua sujeito à inativação se fizer menos de 1.000 de contribuição na semana. ` +
          `Se quiser entender o porquê, fale com um membro da staff.`
    )
    .setTimestamp();

  await client.users.fetch(pedido.discord_id)
    .then(u => u.send({ embeds: [dm] }))
    .catch(() => console.log(`[JUSTIFICATIVA] DM bloqueada: ${pedido.discord_id}`));
}

// .birthday <DD/MM>
export async function handleBirthday(message, args) {
  if (args.length === 0) {
    return message.reply({
      embeds: [createErrorEmbed('Uso incorreto', 'Use: `.birthday DD/MM`')]
    });
  }

  const dateInput = args[0];
  const dateRegex = /^(\d{2})\/(\d{2})$/;
  const match = dateInput.match(dateRegex);

  if (!match) {
    return message.reply({
      embeds: [createErrorEmbed('Formato inválido', 'Use o formato: `DD/MM` (exemplo: 25/12)')]
    });
  }

  const day = match[1];
  const month = match[2];
  const year = '2000'; // Usado só pra validar na DB(não sei se precisaria mudar lá também)
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
      const [, bMonth, bDay] = existing.birthday.split('-');
      return message.reply({
        embeds: [createErrorEmbed('Aniversário já registrado', `Seu aniversário já está registrado para ${bDay}/${bMonth}.`)]
      });
    }

    // Inserir no banco
    await addBirthday(message.author.id, birthdayISO);

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'Aniversário registrado',
          `Seu aniversário foi registrado: **${day}/${month}**`
        )
      ]
    });

  } catch (err) {
    console.error('[Birthday Error]', err);
    return message.reply({
      embeds: [createErrorEmbed('Erro ao registrar', 'Ocorreu um erro ao registrar seu aniversário. Tente novamente.')]
    });
  }
}

// .corrigirID <main_id>
export async function handleCorrigirID(message, args) {
  try {
    const main_id = args[0];

    if (!main_id || !/^\d+$/.test(main_id)) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'ID inválido',
            'Use: `.corrigir-id 123456`'
          )
        ]
      });
    }

    await corrigirID(message.author.id, main_id);

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'ID ajustado',
          `Seu alt foi vinculado ao main ID ${main_id}.`
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [
        createErrorEmbed('Erro ao ajustar ID', err.message)
      ]
    });
  }
}

const crzCooldown = new Map();
const CRZ_COOLDOWN_MS = 5000;

// .crz
export async function handleCrz(message) {
  const now = Date.now();
  const last = crzCooldown.get(message.author.id);
  if (last && now - last < CRZ_COOLDOWN_MS) {
    const remaining = Math.ceil((CRZ_COOLDOWN_MS - (now - last)) / 1000);
    return message.reply({ embeds: [createErrorEmbed('Calma lá!', `Aguarde **${remaining}s** para usar novamente.`)] });
  }
  crzCooldown.set(message.author.id, now);
  try {
    const count = await incrementCrz();

    const guild = message.client.guilds.cache.get(discordConfig.guildId);
    const member = guild ? await guild.members.fetch(message.author.id).catch(() => null) : null;

    if (count === 67) {
      if (member) await member.timeout(67 * 1000, 'crz 67');
      await message.reply({
        content: `vai farmando aura mutado 🫃 (${count})`,
        embeds: [new EmbedBuilder().setImage('https://media.discordapp.net/attachments/1260084537648611409/1437215582326886410/bleedIMG4xqM7x8El2rPJ.gif?ex=6a327e91&is=6a312d11&hm=a8ebf0e0bab88d4aacdca6f7341522bd865e34ffc6fdf008384500a501159d44&=&width=598&height=479')]
      });
      return;
    }

    if (count === 200) {
      await message.reply(`crz liberou o precioso para ${count}, escolha alguem pra levar 5min de mute (mencione em 30s)`);
      const collected = await message.channel.awaitMessages({
        filter: m => m.author.id === message.author.id && m.mentions.members?.size > 0,
        max: 1,
        time: 30000,
        errors: []
      });
      const choice = collected.first();
      if (choice) {
        const victim = choice.mentions.members.first();
        if (victim && !victim.user.bot) {
          await victim.timeout(5 * 60 * 1000, 'crz 200');
          await message.channel.send(`${victim} foi escolhido, 5min de mute`);
        }
      } else {
        await message.channel.send('tempo esgotado, ninguém levou mute dessa vez');
      }
      return;
    }

    if (count === 666) {
      if (member) await member.timeout((6 * 60 + 66) * 1000, 'crz 666');
      await message.reply(`crz liberou o precioso para ${count}, mute de 6min e 66s`);
      return;
    }

await message.reply(`crz liberou o precioso para ${count}`);
  } catch (err) {
    console.error('[CRZ Error]', err);
    await message.reply({ embeds: [createErrorEmbed('Erro', 'Não foi possível atualizar o contador.')] });
  }
}

// .redes
export async function handleRedes(message) {
  function buildEmbed(type = 'redes') {

    if (type === 'spotify') {
      return new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle(`\n`)
        .setDescription(`**${EMOJIS.spotify} Spotify da TGG**\n-# Playlist oficial da guilda\n## 🔗 • Playlist
          ${SOCIALS.spotify}
        `)
        .setFooter({ text: 'TGG • Spotify Oficial' });
    }

    if (type === 'site') {
      return new EmbedBuilder()
        .setColor(0x693C85)
        .setTitle('\n')
        .setDescription(`**🌎 Site Oficial da TGG**\n-# Confira novidades, rankings e informações da guilda.\n## ${EMOJIS.TGGlogo} • Acesse: 
          ${SOCIALS.site}

          Mais **recursos** e **novidades** em breve!
        `)
        .setFooter({ text: 'TGG • Site Oficial' });
    }

    if (type === 'exitlag') {
      return new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`\n`)
        .setDescription(`**${EMOJIS.exitlag} ExitLag**\n-# Reduza ping, perda de pacotes e melhore sua conexão.\n## 🔗 • Link Oficial: 
          ${SOCIALS.exitlag}

          Use o cupom **TEAMTGG** para ganhar desconto!
          Recomendado para melhorar estabilidade na rede.
        `)
        .setFooter({ text: 'TGG • ExitLag Partner' });
    }

    // Padrão = redes sociais
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('\n')
      .setDescription(`**🌐 Redes da TGG**\n-# Acompanhe a guilda em todas as plataformas!\n## 🔗 • Links Oficiais

          ${EMOJIS.discord} Discord: ${SOCIALS.discord}
          ${EMOJIS.twitch} Twitch: ${SOCIALS.twitch}
          ${EMOJIS.youtube} YouTube: ${SOCIALS.youtube}
          ${EMOJIS.tiktok} TikTok: ${SOCIALS.tiktok}

          **Entre, acompanhe e fortaleça a comunidade!**
        `)
      .setFooter({ text: 'TGG • Redes Oficiais' });
  }

  function buildButtons(selected = 'redes') {
    return new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId('redes_social')
        .setLabel('Redes')
        .setEmoji('🌐')
        .setStyle(selected === 'redes' ? 1 : 2),

      new ButtonBuilder()
        .setCustomId('redes_spotify')
        .setLabel('Spotify')
        .setEmoji(`${EMOJIS.spotify}`)
        .setStyle(selected === 'spotify' ? 1 : 2),

      new ButtonBuilder()
        .setCustomId('redes_site')
        .setLabel('Site')
        .setEmoji('🌎')
        .setStyle(selected === 'site' ? 1 : 2),

      new ButtonBuilder()
        .setCustomId('redes_exitlag')
        .setLabel('ExitLag')
        .setEmoji(`${EMOJIS.exitlag}`)
        .setStyle(selected === 'exitlag' ? 1 : 2)
    );
  }

  const msg = await message.reply({
    embeds: [buildEmbed('redes')],
    components: [buildButtons('redes')]
  });

  const collector = msg.createMessageComponentCollector({
    time: 120000
  });

  collector.on('collect', async (interaction) => {

    if (interaction.user.id !== message.author.id) {
      return interaction.reply({
        content: 'Você não pode usar isso.',
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    let type = 'redes';

    if (interaction.customId === 'redes_spotify') {
      type = 'spotify';
    }

    if (interaction.customId === 'redes_site') {
      type = 'site';
    }

    if (interaction.customId === 'redes_exitlag') {
      type = 'exitlag';
    }

    await interaction.editReply({
      embeds: [buildEmbed(type)],
      components: [buildButtons(type)]
    });
  });
}

// .video-guilda
export async function handleVideoGuilda(message, args, client) {
  try {
    const titulo = `🎬 **Vídeo explicativo da guilda**`;
    const { message: sourceMessage, url, file } = videoGuildaConfig;

    if (sourceMessage?.channelId && sourceMessage?.messageId) {
      const channel = await (client ?? message.client).channels
        .fetch(sourceMessage.channelId)
        .catch(() => null);

      const videoMsg = channel?.isTextBased()
        ? await channel.messages.fetch(sourceMessage.messageId).catch(() => null)
        : null;

      if (!videoMsg) {
        return message.reply({
          embeds: [createErrorEmbed('Vídeo Não Encontrado', 'Não consegui acessar a mensagem configurada em `videoGuilda.message`.')]
        });
      }

      const videoUrl = videoMsg.attachments.first()?.url || videoMsg.content.trim();

      if (!videoUrl) {
        return message.reply({
          embeds: [createErrorEmbed('Vídeo Não Encontrado', 'A mensagem configurada não tem nenhum vídeo anexado.')]
        });
      }

      return message.reply({ content: `${titulo}\n${videoUrl}` });
    }

    return message.reply({
      embeds: [createErrorEmbed('Vídeo Não Configurado', 'Nenhuma fonte definida em `videoGuilda` (config/index.js).')]
    });

  } catch (err) {
    console.error('[VideoGuilda Error]', err);
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Enviar Vídeo', err.message)]
    }).catch(() => { });
  }
}

// .duel
export async function handleDuel(message, args, client) {
  try {
    // O placar mora em services/dueloSemanal.js: o `.ia` responde sobre o duelo lendo o mesmo
    // cálculo, e um número que discorda do `.duel` seria pior que não responder.
    const duelo = await calcularDueloDaSemana();

    if (duelo.motivo === SEM_DUELO.SEM_OPONENTE) {
      return message.reply('Nenhuma guilda rival configurada para esta semana.');
    }

    if (duelo.motivo === SEM_DUELO.OPONENTE_SEM_ID) {
      return message.reply('Guilda rival sem guild_id configurado.');
    }

    const { nos, eles } = duelo;
    const ourDiff = nos.ganhoNaSemana;
    const enemyDiff = eles.ganhoNaSemana;

    let winnerText = '🤝 Empate';

    if (duelo.vencendo === 'nos') winnerText = `🏆 ${nos.nome} está vencendo`;
    else if (duelo.vencendo === 'eles') winnerText = `🏆 ${eles.nome} está vencendo`;

    // Convite do Discord de cada guilda, quando a guilda cadastrou um
    const discordDaGuilda = (lado) => lado.convite
      ? `💬 **Discord:** discord.gg/${lado.convite}`
      : '💬 **Discord:** não informado';

    // Semana sem linha de base de XP (gravada antes de a coluna existir) mostra "—" em vez de um
    // número inventado: é a base que transforma o acumulado em ganho da semana.
    const numero = (v) => v == null ? '—' : v.toLocaleString();

    // Top 5 nossos na semana. Falha no cálculo não derruba o duelo.
    const topContribuintes = await topContribuintesDaSemana(5);

    const medalhas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

    let topTexto = 'Ninguém pontuou nesta semana ainda.';

    if (topContribuintes === null) {
      topTexto = 'Não foi possível calcular agora.';
    } else if (topContribuintes.length) {
      topTexto = topContribuintes
        .map((l, i) => `${medalhas[i]} <@${l.discordId}> - **${l.contribuicao.toLocaleString('pt-BR')}**`)
        .join('\n');
    }

    const embed = new EmbedBuilder()
      .setColor(ourDiff >= enemyDiff ? 0x57F287 : 0xED4245)
      .setTitle('⚔️ Duelo Semanal de Guildas')
      .setDescription(winnerText)
      .addFields(
        {
          name: `${nos.nome}`,
          value:
            `👥 **Membros:** ${nos.membros}\n` +
            `📈 **Guild Points:** ${nos.pontosAtuais.toLocaleString()}\n` +
            `🔥 **Pontos na semana:** ${ourDiff.toLocaleString()}\n` +
            `✨ **XP:** ${numero(nos.xpAtual)}\n` +
            `⚡ **XP na semana:** ${numero(nos.ganhoDeXpNaSemana)}\n` +
            discordDaGuilda(nos),
          inline: true
        },
        {
          name: `${eles.nome}`,
          value:
            `👥 **Membros:** ${eles.membros}\n` +
            `📈 **Guild Points:** ${eles.pontosAtuais.toLocaleString()}\n` +
            `🔥 **Pontos na semana:** ${enemyDiff.toLocaleString()}\n` +
            `✨ **XP:** ${numero(eles.xpAtual)}\n` +
            `⚡ **XP na semana:** ${numero(eles.ganhoDeXpNaSemana)}\n` +
            discordDaGuilda(eles),
          inline: true
        },
        {
          name: '📊 Diferença',
          value: `${duelo.diferenca.toLocaleString()} pontos`,
          inline: false
        },
        {
          name: `🏅 Top 5 da semana - ${nos.nome}`,
          value: topTexto,
          inline: false
        }
      )
      .setFooter({
        text: 'Comparação baseada nos pontos semanais'
      })
      .setTimestamp();

    return message.reply({
      embeds: [embed]
    });

  } catch (err) {
    console.error(err);

    return message.reply('Erro ao buscar informações do duelo.');
  }
}

// .alts [@usuario/id] - contas vinculadas pelo .corrigir-id e pelo .add-account
export async function handleAlts(message, args) {
  let loadingMsg = null;

  try {
    let targetUserId = message.author.id;
    let outroUsuario = false;

    if (message.interaction) {
      const u = message.interaction.options.getUser('usuario');
      if (u) { targetUserId = u.id; outroUsuario = true; }
    } else if (args.length > 0) {
      const mencao = args[0].match(/^<@!?(\d+)>$/);
      if (mencao) { targetUserId = mencao[1]; outroUsuario = true; }
      else if (/^\d+$/.test(args[0])) { targetUserId = args[0]; outroUsuario = true; }
    }

    if (outroUsuario && !(await isAdmin(message.author.id))) {
      return await message.reply({
        embeds: [createErrorEmbed('Acesso negado', 'Você só pode ver as suas próprias contas.')]
      });
    }

    const user = await getUserByDiscordId(targetUserId);

    if (!user || !user.brawlhalla_id) {
      return await message.reply({
        embeds: [createErrorEmbed('Sem cadastro', 'Este usuário não tem Brawlhalla ID registrado.')]
      });
    }

    loadingMsg = await message.reply({
      embeds: [createLoadingEmbed(null, `${EMOJIS.loading} Buscando as contas vinculadas...`)]
    });

    // A conta da guilda é o ID cru, sem resolve: é ela que está no clã
    const contaGuilda = String(user.brawlhalla_id);
    const { mainReal, alts } = await getContasVinculadas(contaGuilda);

    // Ordem de exibição: guilda, principal, alternativas. Sem repetir ID.
    const contas = [];
    const vistos = new Set();

    const adicionar = (id, rotulo) => {
      if (!id || vistos.has(id)) return;
      vistos.add(id);
      contas.push({ id, rotulo });
    };

    adicionar(contaGuilda, 'guilda');
    adicionar(mainReal, 'main');
    alts.forEach((id) => adicionar(id, 'alt'));

    // Uma requisição por conta na v1 — cota de 2000/5min, jogador tem poucas contas.
    // Falha de uma conta não derruba a listagem: ela aparece sem os dados.
    const dados = await Promise.all(
      contas.map(async (c) => {
        try {
          return { ...c, info: await fetchPlayerBasicNewAPI(c.id) };
        } catch (err) {
          console.warn(`[ALTS] Dados indisponíveis para ${c.id}:`, err.message);
          return { ...c, info: null };
        }
      })
    );

    const linha = (c) => {
      if (!c.info) return `\`${c.id}\` - _dados indisponíveis na API_`;
      const { name, level, games, wins } = c.info;
      return `\`${c.id}\` **${name}** - Nv ${level} · ${games.toLocaleString('pt-BR')} jogos · ${wins.toLocaleString('pt-BR')} vitórias`;
    };

    const daGuilda = dados.find((c) => c.rotulo === 'guilda');
    const principal = dados.find((c) => c.rotulo === 'main');
    const alternativas = dados.filter((c) => c.rotulo === 'alt');

    const partes = [
      `${EMOJIS.greaterthan || '›'} **Conta da guilda**`,
      linha(daGuilda),
    ];

    if (principal) {
      partes.push('', '⭐ **Conta principal** - registrada com `.corrigir-id`', linha(principal));
    }

    if (alternativas.length) {
      partes.push('', `🎮 **Contas alternativas** (${alternativas.length}) - registradas com \`.add-account\``);
      alternativas.forEach((c) => partes.push(linha(c)));
    }

    if (!principal && !alternativas.length) {
      partes.push('', '_Nenhuma outra conta vinculada._',
        'Use `.corrigir-id <id>` se você joga em outra conta, ou `.add-account <id>` para somar o progresso de uma conta alternativa nas conquistas.');
    }

    const nomeExibido = daGuilda?.info?.name ?? user.username ?? 'Conta';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🔗 Contas de ${nomeExibido}`)
      .setDescription(`<@${targetUserId}>\n\n${partes.join('\n')}`)
      .setFooter({
        text: contas.length > 1
          ? `${contas.length} contas vinculadas • o ID da guilda é o do dispositivo em que você entrou`
          : 'O ID da guilda é o do dispositivo em que você entrou no jogo'
      });

    return await sendCleanMessage(loadingMsg, { embeds: [embed] });

  } catch (err) {
    console.error('[ALTS]', err);
    const erro = createErrorEmbed('Erro ao buscar contas', err.message);

    if (loadingMsg) return await sendCleanMessage(loadingMsg, { embeds: [erro] });
    return await message.reply({ embeds: [erro] });
  }
}

// .resumo - guia da guilda em páginas: como a semana funciona, contribuição, missões, MVP, inatividade, economia e regras.
export async function handleResumo(message, args, client) {
  const canalInativos = `<#${inactivePlayersConfig.channelId}>`;
  const minimo = CONTRIBUICAO_MINIMA.toLocaleString('pt-BR');

  const paginas = [
    {
      value: 'geral',
      label: 'Visão geral',
      emoji: '🏰',
      descricao: 'Como a semana da guilda funciona',
      embed: new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🏰 Team TGG - como a guilda funciona')
        .setDescription(
          'Tudo na guilda gira em torno de **uma semana de missões** e de **uma moeda: a contribuição** ' +
          '(os *guild points* que aparecem na aba da guilda dentro do jogo).\n\n' +
          '**A semana começa na quinta às 06:00 e fecha na quarta às 06:00.**\n' +
          'Quando ela fecha, três coisas acontecem sozinhas:'
        )
        .addFields(
          {
            name: `${EMOJIS.arrowRight} Quarta, 06:00 - MVP da semana`,
            value: `Os **${weeklyMvpConfig.limite} maiores contribuidores** ganham o cargo de MVP Semanal.`,
            inline: false
          },
          {
            name: `${EMOJIS.arrowRight} Quarta, logo depois - inatividade`,
            value: `Quem ficou abaixo de **${minimo} de contribuição** entra na lista de inativos e recebe uma DM do bot.`,
            inline: false
          },
          {
            name: `${EMOJIS.arrowRight} Quinta, 06:00 - semana nova`,
            value: 'As **4 missões** da semana são cadastradas e a contagem de contribuição zera para todo mundo.',
            inline: false
          },
          {
            name: `${EMOJIS.square} O que se espera de você`,
            value:
              `${EMOJIS.check} Fazer pelo menos **${minimo} de contribuição** por semana\n` +
              `${EMOJIS.check} Fazer as missões da guilda (é o que mais rende ponto)\n` +
              `${EMOJIS.check} Jogar com membros da guilda\n` +
              `${EMOJIS.check} Avisar quando for ficar sem jogar, com \`.justificativa\``,
            inline: false
          }
        )
        .setThumbnail(message.guild?.iconURL() ?? null)
    },

    {
      value: 'contribuicao',
      label: 'Contribuição',
      emoji: '🎯',
      descricao: 'A pontuação que vale de verdade',
      embed: new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🎯 Contribuição (guild points)')
        .setDescription(
          'Contribuição é o **guild point** que você ganha nas missões da guilda. É o único número que a ' +
          'staff avalia: é ele que define MVP, inatividade e o duelo contra outra guilda.'
        )
        .addFields(
          {
            name: `${EMOJIS.square} Mínimo semanal`,
            value: `**${minimo} por semana.** Abaixo disso você é marcado como inativo quando a semana fecha.`,
            inline: false
          },
          {
            name: `${EMOJIS.square} XP não é contribuição`,
            value:
              'XP você ganha em qualquer partida, inclusive contra bots — ele mede só volume de jogo. ' +
              'Contribuição vem das **missões da guilda**. São coisas diferentes.',
            inline: false
          },
          {
            name: `${EMOJIS.square} Como conferir`,
            value:
              `${EMOJIS.check} No jogo: aba da guilda → sua linha\n` +
              `${EMOJIS.check} \`.stats\` - seus dados atualizados\n` +
              `${EMOJIS.check} \`.games\` - quantas partidas você jogou na semana\n` +
              `${EMOJIS.check} \`.guild\` - o total da guilda`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Joga em outra conta?`,
            value:
              'A contribuição só conta na conta que **está na guilda**. Se você entrou com uma alt, use ' +
              '`.corrigir-id <id>` para apontar sua conta principal e `.alts` para conferir o que está vinculado.',
            inline: false
          }
        )
    },

    {
      value: 'missoes',
      label: 'Missões',
      emoji: '📜',
      descricao: 'As 4 missões semanais',
      embed: new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('📜 Missões da semana')
        .setDescription(
          'Toda **quinta às 06:00** entram 4 missões novas, e elas valem até a **quarta às 06:00**. ' +
          'Use `.missoes` para ver as da semana atual, com o objetivo e a dica de cada uma.'
        )
        .addFields(
          {
            name: `${EMOJIS.square} O que costuma cair`,
            value:
              `${EMOJIS.check} **Hordas** e Walker Attack\n` +
              `${EMOJIS.check} **Ranked 2v2 / 3v3 com membros da guilda** (não precisa vencer, precisa ser com a guilda)\n` +
              `${EMOJIS.check} **Chegar a um ELO** (ouro, platina, diamante) - depois da MD10, ganhe uma partida para contabilizar\n` +
              `${EMOJIS.check} **Modos em lobby**: Crew Battle, Brawlball, Kungfoot\n` +
              `${EMOJIS.check} **Brawl of the Week** - aí sim é preciso vencer`,
            inline: false
          },
          {
            name: `${EMOJIS.square} A dica importa`,
            value:
              'Várias missões só contabilizam de um jeito específico (time formado só por membros, lobby ' +
              'com placar montado, vitória depois da MD10). A dica de cada missão está no `.missoes` — leia antes de farmar.',
            inline: false
          },
          {
            name: `${EMOJIS.square} Conquistas`,
            value:
              'Além das missões da guilda, a semana tem **conquistas** que pagam TGG Coins: subir de ELO, ' +
              'vitórias, partidas jogadas e contribuição. Veja em `.conquistas`.',
            inline: false
          }
        )
    },

    {
      value: 'mvp',
      label: 'MVP e duelo',
      emoji: '🏅',
      descricao: 'Premiação da semana e o duelo de guildas',
      embed: new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('🏅 MVP Semanal e duelo de guildas')
        .addFields(
          {
            name: `${EMOJIS.square} MVP Semanal`,
            value:
              `Os **${weeklyMvpConfig.limite} maiores contribuidores** da semana recebem o cargo na quarta de manhã. ` +
              'O cargo é trocado toda semana — para manter, é preciso repetir a contribuição.',
            inline: false
          },
          {
            name: `${EMOJIS.square} O que o MVP ganha`,
            value:
              `${EMOJIS.check} **+40% de TGG Coins** no \`.daily\`\n` +
              `${EMOJIS.check} O cargo e a cor no servidor`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Duelo de guildas`,
            value:
              'Toda semana a TGG é pareada com outra guilda pela classificação (1º×2º, 3º×4º, 5º×6º). ' +
              'Use `.duel` para ver contra quem estamos e como está o placar.',
            inline: false
          }
        )
    },

    {
      value: 'inatividade',
      label: 'Inatividade',
      emoji: '💤',
      descricao: 'Como sair da lista e como se blindar',
      embed: new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💤 Inatividade')
        .setDescription(
          `Quando a semana fecha na quarta, quem fez menos de **${minimo} de contribuição** recebe o cargo ` +
          'de inativo e uma DM do bot. Não é punição — é a forma de saber quem ainda está jogando.'
        )
        .addFields(
          {
            name: `${EMOJIS.square} Caiu na lista? Use \`.active\``,
            value:
              `\`.active <motivo>\` — só funciona em ${canalInativos}, e o motivo precisa de pelo menos 15 caracteres.`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Vai ficar um tempo sem jogar? Avise antes`,
            value:
              `\`.justificativa <motivo> <semanas>\` pede **blindagem** por até ${MAX_SEMANAS} semanas ` +
              '(prova, viagem, trabalho, saúde). O pedido fica pendente até um membro da staff aprovar — ' +
              '**enquanto não for aprovado, ele não protege nada.**',
            inline: false
          },
          {
            name: `${EMOJIS.square} Quem não entra na conta`,
            value:
              `${EMOJIS.check} Quem entrou na guilda no meio da semana (não teve semana inteira)\n` +
              `${EMOJIS.check} Quem está com blindagem aprovada\n` +
              `${EMOJIS.check} Staff da guilda`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Lembrete de domingo`,
            value:
              `Todo domingo ao meio-dia o bot avisa quem ainda não bateu os ${minimo}. ` +
              'Se você foi marcado, ainda dá tempo de correr atrás até quarta.',
            inline: false
          }
        )
    },

    {
      value: 'coins',
      label: 'TGG Coins',
      emoji: '🪙',
      descricao: 'Como ganhar e onde gastar',
      embed: new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`${EMOJIS.TGGcoin} TGG Coins`)
        .setDescription('A moeda do servidor. Ela não afeta sua situação na guilda — serve para a loja.')
        .addFields(
          {
            name: `${EMOJIS.square} Como ganhar`,
            value:
              `${EMOJIS.check} \`.daily\` todo dia: **50** moedas, **75** com 3 dias de streak, ` +
              `**100** com 7 dias e **150** com 67 dias\n` +
              `${EMOJIS.check} \`.conquistas\` — as conquistas da semana pagam por ELO, vitórias, partidas e contribuição\n` +
              `${EMOJIS.check} \`.quiz\` — **${QUIZ_REWARD}** moedas por acertar o quiz da guilda\n` +
              `${EMOJIS.check} \`.motd <mensagem>\` — **${MOTD_REWARD}** moedas por mandar uma mensagem para o sorteio`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Bônus no daily`,
            value:
              `${EMOJIS.check} **MVP Semanal: +40%**\n` +
              `${EMOJIS.check} **VIP: +20%**\n` +
              'Os dois acumulam. Perdeu um dia? A streak pode ser recuperada por 300 moedas.',
            inline: false
          },
          {
            name: `${EMOJIS.square} Onde gastar`,
            value:
              `${EMOJIS.check} \`.shop\` — ver a loja | \`.buy <número>\` — comprar\n` +
              `${EMOJIS.check} \`.inventory\` — equipar e trocar suas cores\n` +
              `${EMOJIS.check} \`.balance\` — saldo | \`.historico\` — o que você já gastou\n` +
              `${EMOJIS.check} \`.leaderboard\` — quem tem mais moedas`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Joga em mais de uma conta?`,
            value: '`.add-account <id>` soma o progresso das suas alts nas conquistas.',
            inline: false
          }
        )
    },

    {
      value: 'regras',
      label: 'Regras',
      emoji: '📋',
      descricao: 'Convivência e o que não é tolerado',
      embed: new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle('📋 Regras da guilda')
        .setDescription('Poucas regras, todas simples. `.regras` mostra esta lista a qualquer momento.')
        .addFields(
          {
            name: `${EMOJIS.square} Sem toxicidade`,
            value:
              `${EMOJIS.xis} Nada de nomes ofensivos\n` +
              `${EMOJIS.xis} Nada de mau comportamento, dentro ou fora do jogo\n` +
              `${EMOJIS.check} Reporte o que sair da linha para a staff`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Respeite a staff e o servidor`,
            value: `${EMOJIS.check} Siga as diretrizes do Discord e as decisões da staff.`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Contribua`,
            value: `${EMOJIS.check} Mínimo de **${minimo} de contribuição por semana**, medido de quinta a quarta.`,
            inline: false
          },
          {
            name: `${EMOJIS.square} Nada de cheats ou toxicidade`,
            value: `${EMOJIS.xis} Vale expulsão da guilda.`,
            inline: false
          },
          {
            name: `${EMOJIS.greaterthan} Seja bem-vindo!`,
            value: 'Aproveite, conheça os membros e chame a staff se tiver qualquer dúvida.',
            inline: false
          }
        )
    },

    {
      value: 'comandos',
      label: 'Comandos',
      emoji: '🤖',
      descricao: 'Os comandos que você pode usar',
      embed: new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🤖 Comandos')
        .setDescription('Todos funcionam como `.comando` ou `/comando`. `.help` traz a lista completa.')
        .addFields(
          {
            name: '⚔️ Guilda',
            value:
              '`.missoes`\n`.stats`\n`.games`\n`.guild`\n`.duel`\n`.alts`\n`.corrigir-id`',
            inline: true
          },
          {
            name: `${EMOJIS.TGGcoin} TGG Coins`,
            value:
              '`.daily`\n`.streak`\n`.conquistas`\n`.balance`\n`.shop`\n`.buy`\n`.inventory`\n`.quiz`\n`.leaderboard`',
            inline: true
          },
          {
            name: '📖 Informações',
            value:
              '`.resumo`\n`.regras`\n`.redes`\n`.motd`\n`.birthday`\n`.video-guilda`\n`.help`',
            inline: true
          },
          {
            name: `${EMOJIS.square} Inatividade`,
            value: `\`.active <motivo>\` (em ${canalInativos})\n\`.justificativa <motivo> <semanas>\``,
            inline: false
          }
        )
    }
  ];

  let atual = 0;

  const montarEmbed = () =>
    EmbedBuilder.from(paginas[atual].embed)
      .setFooter({ text: `Página ${atual + 1}/${paginas.length} • ${paginas[atual].label}` })
      .setTimestamp();

  const montarComponentes = () => {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('resumo_menu')
      .setPlaceholder('Escolha um assunto...')
      .addOptions(
        paginas.map((p, i) => ({
          label: p.label,
          value: p.value,
          emoji: p.emoji,
          description: p.descricao,
          default: i === atual
        }))
      );

    const navegacao = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('resumo_prev')
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(atual === 0),
      new ButtonBuilder()
        .setCustomId('resumo_next')
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(atual === paginas.length - 1)
    );

    return [new ActionRowBuilder().addComponents(menu), navegacao];
  };

  const sent = await message.reply({ embeds: [montarEmbed()], components: montarComponentes() });

  const collector = sent.createMessageComponentCollector({ time: 300000 });

  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({
        content: 'Use `.resumo` para abrir o seu.',
        ephemeral: true
      });
    }

    try {
      if (interaction.customId === 'resumo_prev') {
        atual = Math.max(0, atual - 1);
      } else if (interaction.customId === 'resumo_next') {
        atual = Math.min(paginas.length - 1, atual + 1);
      } else {
        const escolhida = paginas.findIndex((p) => p.value === interaction.values[0]);
        if (escolhida >= 0) atual = escolhida;
      }

      await interaction.update({ embeds: [montarEmbed()], components: montarComponentes() });
    } catch (err) {
      console.error('[RESUMO] Erro na navegação:', err);
    }
  });

  collector.on('end', async () => {
    await sent.edit({ components: [] }).catch(() => {});
  });
}