// public.js - Comandos públicos
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder } from 'discord.js';
import { getUsers, getUsersWithElo, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, getClient, reactivateOrAddUser, addPersistentMute, removePersistentMute, getActiveMutes, getMissionWeekStart, getActiveUser } from './db.js';
import { fetchPlayerStats, fetchClanStats, createStatsEmbed, createRankedEmbed, createClanEmbed, getUserBrawlhallaId, getCached } from './brawlhalla.js';
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig } from '../config/index.js';

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

function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`❌ ${title}`)
    .setDescription(description);
}

function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`✅ ${title}`)
    .setDescription(description);
}

async function sendCleanMessage(msg, content) {
  try {
    if (msg && msg.edit) {
      return await msg.edit(content);
    }
    return await msg.channel.send(content);
  } catch (e) {
    console.error('Erro mandando mensagem:', e);
    return null;
  }
}

async function isAdmin(userId) {
  try {
    const user = await getUserByDiscordId(userId);

    if (!user) return false;
    return user.role?.toLowerCase() === 'admin' && user.active;
  } catch (err) {
    return false;
  }
}

// ---- .help ----
export async function handleHelp(message) {
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

// ---- .regras ----
export async function handleRegras(message) {
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

// ---- .stats ----
export async function handleStats(message, args) {
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

// ---- .clan ----
export async function handleClan(message, args) {
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

// ---- .missoes ----
export async function handleMissoes(message) {
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

// ---- .active ----
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