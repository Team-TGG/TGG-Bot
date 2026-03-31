// public.js - Comandos públicos
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder } from 'discord.js';
import { getWeeklyMissions, getInactivePlayers, removeInactivePlayer, reactivateOrAddUser, getUsers } from './db.js';
import { fetchPlayerStats, fetchClanStats, createStatsEmbed, createRankedEmbed, createClanEmbed, getUserBrawlhallaId, getCached } from './brawlhalla.js';
import { discord as discordConfig } from '../config/index.js';
import { createClient, runSync, runEloSync } from './discord.js';
import { runAndPostGuildActivity } from './guildActivity.js';

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

// ---- .help ----
export async function handleHelp(message) {
  const EMOJIS = {
    arrowLeft: '<:arrowleft:1475806697162539059>',
    arrowRight: '<:arrowright:1475806826833383456>',
    check: '<:check:1475806856722120838>',
    crossedSwords: '<:crossedswords:1475806953153466489>',
    refresh: '<:refresh:1475807000683384893>',
    book: '<:book:1475807033541279825>',
    gear: '<:gear:1475807066089549945>',
    sleep: '<:sleep:1475807101294637126>',
    hammer: '<:hammer:1475807133887971378>',
    graduation: '<:graduation:1475807164604661781>',
    coin: '<:coin:1475807196169695282>',
    loading: '<a:loading:1475807230899867709>'
  };

  const page1 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.crossedSwords} Guilda`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .sync`, value: 'Sincronizar todos os dados da guild', inline: false },
      { name: `${EMOJIS.arrowRight} .sync-elo`, value: 'Sincronizar apenas os elos', inline: false },
      { name: `${EMOJIS.arrowRight} .guild-activity`, value: 'Mostrar atividade da guild', inline: false },
      { name: `${EMOJIS.arrowRight} .mov [data_inicio] [data_fim]`, value: 'Mostrar movimentação de membros', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no menu abaixo' })
    .setTimestamp();

  const page2 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.refresh} Informações`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .stats [@user]`, value: 'Ver estatísticas do Brawlhalla', inline: false },
      { name: `${EMOJIS.arrowRight} .clan [clan_id]`, value: 'Ver informações do clã', inline: false },
      { name: `${EMOJIS.arrowRight} .missoes`, value: 'Ver missões semanais', inline: false },
      { name: `${EMOJIS.arrowRight} .regras`, value: 'Ver regras da guild', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no menu abaixo' })
    .setTimestamp();

  const page3 = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.coin} TGG-Coins`)
    .addFields(
      { name: `${EMOJIS.arrowRight} .daily`, value: 'Receber recompensa diária', inline: false },
      { name: `${EMOJIS.arrowRight} .balance`, value: 'Ver seu saldo de TGG-Coins', inline: false },
      { name: `${EMOJIS.arrowRight} .historico`, value: 'Ver histórico de transações', inline: false },
      { name: `${EMOJIS.arrowRight} .leaderboard`, value: 'Ver ranking de TGG-Coins', inline: false },
      { name: `${EMOJIS.arrowRight} .shop`, value: 'Ver loja de itens', inline: false },
      { name: `${EMOJIS.arrowRight} .buy [id]`, value: 'Comprar item da loja', inline: false }
    )
    .setFooter({ text: 'Selecione uma categoria no menu abaixo' })
    .setTimestamp();

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('help_menu')
    .setPlaceholder('Escolha uma categoria...')
    .addOptions(
      { label: 'Guilda', value: 'guild', emoji: EMOJIS.crossedSwords, description: 'Comandos da guilda' },
      { label: 'Informações', value: 'info', emoji: EMOJIS.refresh, description: 'Estatísticas e informações' },
      { label: 'TGG-Coins', value: 'coins', emoji: EMOJIS.coin, description: 'Sistema de moedas' }
    );

  const backButton = new ButtonBuilder()
    .setCustomId('help_back')
    .setLabel('Voltar')
    .setStyle(1);

  const row = new ActionRowBuilder().addComponents(selectMenu);
  const rowWithBack = new ActionRowBuilder().addComponents(backButton);

  const helpMsg = await message.reply({ embeds: [page1], components: [row] });

  const collector = helpMsg.createMessageComponentCollector({ time: 120000 });

  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: 'Você não pode usar este menu.', ephemeral: true });
    }

    if (interaction.customId === 'help_menu') {
      const selected = interaction.values[0];
      let embedToShow = page1;
      if (selected === 'guild') embedToShow = page1;
      if (selected === 'info') embedToShow = page2;
      if (selected === 'coins') embedToShow = page3;
      await interaction.update({ embeds: [embedToShow], components: [row, rowWithBack] });
    } else if (interaction.customId === 'help_back') {
      await interaction.update({ embeds: [page1], components: [row] });
    }
  });

  collector.on('end', () => {
    helpMsg.delete().catch(() => {});
  });
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

    const EMOJIS = { loading: '<a:loading:1475807230899867709>' };
    
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
      // Botão expira
    });

  } catch (err) {
    console.error('Error fetching stats:', err);
    const errorEmbed = createErrorEmbed('Erro ao Buscar Estatísticas', err.message);
    await message.reply({ embeds: [errorEmbed] }).catch(() => { });
  }
}

// ---- .clan ----
export async function handleClan(message, args) {
  let loadingMsg;
  try {
    let clanId = process.env.BRAWLHALLA_CLAN_ID || '396943';
    if (args.length > 0 && /^\d+$/.test(args[0])) {
      clanId = args[0];
    }

    // Verifica cache primeiro
    const cachedData = getCached(`clan:${clanId}`, true);
    if (cachedData) {
      return await message.reply({ embeds: [createClanEmbed(cachedData)] });
    }

    const EMOJIS = { loading: '<a:loading:1475807230899867709>' };
    
    const loadingEmbed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle(`${EMOJIS.loading} Carregando informações do clã...`)
      .setDescription('Buscando dados do Brawlhalla...');

    loadingMsg = await message.reply({ embeds: [loadingEmbed] });
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

// ---- .active ----
export async function handleActive(message, args) {
  try {
    if (!message.guild) {
      return message.reply({ embeds: [createErrorEmbed('Comando Inválido', 'Este comando só pode ser usado no servidor.')] });
    }

    // Verifica se usuário está tentando ativar outra pessoa (apenas admin)
    const mentionMatch = args[0]?.match(/^<@!?(\d+)>$/);
    const idMatch = args[0]?.match(/^\d+$/);
    let targetId = message.author.id;
    let isAdminAction = false;

    if (mentionMatch || idMatch) {
      targetId = mentionMatch ? mentionMatch[1] : args[0];
      if (targetId !== message.author.id) {
        // Verifica se é admin
        const { ALLOWED_USER_IDS } = await import('../config/index.js');
        if (!ALLOWED_USER_IDS.includes(message.author.id)) {
          return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem ativar outros usuários.')] });
        }
        isAdminAction = true;
      }
    }

    // Obtém justificativa dos argumentos restantes
    const justification = args.slice(isAdminAction ? 1 : 0).join(' ') || 'Sem justificativa';

    // Remove da lista de inativos
    await removeInactivePlayer(targetId);
    
    // Garante que usuário existe no banco de dados
    await reactivateOrAddUser(targetId, '0', 'Member');

    // Remove cargo de inativo se existir
    const member = await message.guild.members.fetch(targetId).catch(() => null);
    if (member) {
      const inactiveRole = message.guild.roles.cache.find(r => r.name === 'Inativo');
      if (inactiveRole) {
        await member.roles.remove(inactiveRole).catch(() => {});
      }
    }

    await message.reply({
      embeds: [createSuccessEmbed('Ativado', `<@${targetId}> foi removido da lista de inativos.\n**Justificativa:** ${justification}`)]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro', err.message)] });
  }
}

// ---- .regras ----
export async function handleRegras(message) {
  const rulesEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Regras da Guild')
    .setDescription(
      '**1.** Respeite todos os membros\n' +
      '**2.** Proibido spam ou flood\n' +
      '**3.** Mantenha as conversas nos canais apropriados\n' +
      '**4.** Proibido conteúdo NSFW\n' +
      '**5.** Siga as diretrizes do Discord'
    )
    .setFooter({ text: 'Última atualização: 2024' })
    .setTimestamp();

  await message.reply({ embeds: [rulesEmbed] });
}

// ---- .missoes ----
export async function handleMissoes(message) {
  try {
    const missions = await getWeeklyMissions();

    if (!missions || missions.length === 0) {
      return message.reply({ embeds: [createErrorEmbed('Sem Missões', 'Não há missões ativas no momento.')] });
    }

    const missionsEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎯 Missões Semanais')
      .setDescription(missions.map((m, i) => 
        `**${i + 1}.** ${m.description} - ${m.points} pontos`
      ).join('\n'))
      .setFooter({ text: 'Missões resetam toda segunda-feira' })
      .setTimestamp();

    await message.reply({ embeds: [missionsEmbed] });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro', err.message)] });
  }
}

// ---- .sync ----
export async function handleSync(message, client) {
  const EMOJIS = { loading: '<a:loading:1475807230899867709>' };
  
  const loading = await message.reply({ 
    embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Executando sincronização completa...')] 
  });
  
  try {
    const users = await getUsers();
    await runSync(users, client);
    await sendCleanMessage(loading, { 
      embeds: [createSuccessEmbed('Sincronizado', `Sincronização completa! ${users.length} usuários processados.`)] 
    });
  } catch (err) {
    await sendCleanMessage(loading, { 
      embeds: [createErrorEmbed('Erro na Sincronização', err.message)] 
    });
  }
}

// ---- .sync-elo ----
export async function handleSyncElo(message, client) {
  const EMOJIS = { loading: '<a:loading:1475807230899867709>' };
  
  const loading = await message.reply({ 
    embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando Elos...`).setDescription('Atualizando cargos de elo...')] 
  });
  
  try {
    const users = await getUsers();
    await runEloSync(users, client);
    await sendCleanMessage(loading, { 
      embeds: [createSuccessEmbed('Elos Sincronizados', `Cargos de elo atualizados para ${users.length} usuários.`)] 
    });
  } catch (err) {
    await sendCleanMessage(loading, { 
      embeds: [createErrorEmbed('Erro na Sincronização', err.message)] 
    });
  }
}

// ---- .guild-activity ----
export async function handleGuildActivity(message) {
  try {
    await runAndPostGuildActivity();
    await message.reply({ embeds: [createSuccessEmbed('Atividade', 'Atividade da guild sincronizada!')] });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro', err.message)] });
  }
}
