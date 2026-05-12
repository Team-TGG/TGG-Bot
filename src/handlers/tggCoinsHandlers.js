// Comandos da TGG-Coins
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle } from 'discord.js';
import * as tggCoins from '../tggCoins.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from '../../utils/discordUtils.js';
import { adminOnly, leaderOnly, ROLE_HIERARCHY } from '../../utils/permissions.js';
import { STAFF_ROLE_IDS } from '../../config/index.js';
import { EMOJIS } from '../../config/emojis.js';

// Cargos relacionados às TGG-Coins (IDs dos cargos no Discord)
export const TGG_COINS_ROLES = {
  MVP_SEMANAL:  '1448466041997889769',  // MVP Semanal
  VIP:          '1490462353995731054',  // VIP
  BOOSTER:      '1437560273031528470'   // Booster
};

// Buy Handlers

// Se for um serviço, escolhe o prestador antes de finalizar a compra
export async function handleBuyService(ctx) {
  const { message, item, discordId, finalPrice } = ctx;

  const providers = await tggCoins.getServiceProviders(item.id);
 
  // Se não tiver prestadores, avisa que não tem como comprar o serviço no momento
  if (!providers.length) {
    return message.reply({
    embeds: [createErrorEmbed('Sem prestadores', 'Nenhum usuário disponível para este serviço.')]
      });
  }

  const options = [];

  for (const p of providers) {
    try {
      const member = await message.guild.members.fetch(p.discord_id);

      options.push({
        label: member.user.username,
        value: p.discord_id
      });
      } catch {
        // ignora usuários que não estão mais na guilda
    }
  }

  if (!options.length) {
    return message.reply({
      embeds: [createErrorEmbed('Erro', 'Nenhum prestador válido encontrado.')]
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`service_${item.id}`)
    .setPlaceholder('Escolha o prestador')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);

  const msg = await message.reply({
    content: `Selecione quem irá realizar **${item.name}**:`,
    components: [row]
  });

  const collector = msg.createMessageComponentCollector({
    time: 60000
  });

  // Caso tente usar o comando de outra pessoa, bloqueia
  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== discordId) {
      return interaction.reply({
        content: 'Você não pode usar isso.',
        ephemeral: true
      });
    }

    const providerId = interaction.values[0];

    // Impede de contratar a si mesmo (caso seja prestador de algum serviço)
    if (providerId === discordId) {
      return interaction.reply({
        content: 'Você não pode contratar a si mesmo.',
        ephemeral: true
      });
    }

    // Dupla validação no saldo
    const balanceNow = await tggCoins.getBalance(discordId);

    if (balanceNow < finalPrice) {
      return interaction.reply({
        embeds: [createErrorEmbed('Saldo insuficiente', 'Você não tem saldo suficiente.')],
        ephemeral: true
      });
    }

    // Gera a transação de pagamento para o comprador
    await tggCoins.addTransaction(discordId, -finalPrice, 'SERVICE_PAYMENT', `Serviço: ${item.name}`);
    const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

    // Gera a transação de recebimento para o prestador
    await tggCoins.addTransaction(providerId, finalPrice, 'SERVICE_RECEIVED', `Serviço: ${item.name}`);
    await tggCoins.updateBalance(providerId, finalPrice);

    // Registrar compra
    await tggCoins.createPurchase(discordId, item);

    await interaction.update({
      content: `<@${providerId}>`,
      embeds: [
        createSuccessEmbed(
          'Serviço contratado!',
          `Você contratou **${item.name}**.\nPrestador: <@${providerId}>\nSaldo atual: **${newBalance}**`
        )
      ],
      components: []
    });

    collector.stop();
  });

  return;
}

// Para itens de MUTE, precisa escolher o usuário a ser mutado antes de finalizar a compra
export async function handleBuyMute(ctx) {
  const { message, item, discordId, finalPrice } = ctx;

  const canUse = await tggCoins.canUseItem(discordId, item.id);
  
  // Verifica se já passou 1 hora desde o último mute comprado
  if (!canUse) {
    return message.reply({
      embeds: [
        createErrorEmbed(
          'Cooldown ativo',
          'Você já usou o mute recentemente. Aguarde 1 hora.'
        )
      ]
    });
  }

  await message.reply({
    content: 'Marque o usuário que você deseja mutar (30s):'
  });

  const filter = (m) => m.author.id === discordId;

  const collector = message.channel.createMessageCollector({
    filter,
    time: 30000,
    max: 1
  });

  collector.on('collect', async (msgResponse) => {
    const target = msgResponse.mentions.members.first();

    // Se não existir o usuário
    if (!target) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Você precisa marcar um usuário válido.')]
      });
    }

    // Não pode se mutar
    if (target.id === discordId) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Você não pode mutar a si mesmo.')]
      });
    }

    // Não pode mutar nenhum bot
    if (target.user.bot) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Você não pode mutar bots.')]
      });
    }

    try {
      // Desconta saldo
      await tggCoins.addTransaction(discordId, -finalPrice, 'SHOP_PURCHASE', `Mute: ${target.user.username}`);
      const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

      // Registra compra
      await tggCoins.createPurchase(discordId, item);

      // Diminui estoque (se tiver)
      await tggCoins.decreaseStock(item.id, item.stock);

      // Aplica timeout de 30s
      await target.timeout(30 * 1000, `Mutado por ${message.author.username}`);

      return message.reply({
        embeds: [
          createSuccessEmbed(
            'Mutado com sucesso!',
            `🔇 ${target.user.username} foi mutado por 30 segundos.\nSaldo atual: **${newBalance}**`
          )
        ]
      });

      } catch (err) {
        return message.reply({
          embeds: [createErrorEmbed('Erro ao mutar', err.message)]
        });
      }
  });

  collector.on('end', (collected) => {
    if (!collected.size) {
      message.reply({
        embeds: [createErrorEmbed('Tempo esgotado', 'Você não escolheu ninguém.')]
      });
    }
  });

  return;
}

// Para itens tipo SERVER
export async function handleBuyServer(ctx) {
  const { message, item, discordId, finalPrice } = ctx;

  const rolesToPing = Object.entries(ROLE_HIERARCHY)
    .filter(([roleId, level]) => level >= ROLE_HIERARCHY[STAFF_ROLE_IDS.administrator])
    .map(([roleId]) => `<@&${roleId}>`)
    .join(' ');

  if (!rolesToPing) {
    return message.reply({
      embeds: [createErrorEmbed('Erro', 'Nenhum cargo de administrador encontrado.')]
    });
  }

  await tggCoins.addTransaction(discordId, -finalPrice, 'SHOP_PURCHASE', `Server: ${item.name}`);
  const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

  await tggCoins.createPurchase(discordId, item);
  await tggCoins.decreaseStock(item.id, item.stock);

  return message.reply({
    content: rolesToPing,
    embeds: [
      createSuccessEmbed(
        'Compra realizada!',
        `Você ativou **${item.name}**.\nA staff foi notificada.\nSaldo atual: **${newBalance}**`
      )
    ]
  });
}

// Cargos de cor (ROLE_REGULAR + ROLE_VIP)
export async function handleBuyRoleColor(ctx) {
  const { message, item, discordId, finalPrice, member } = ctx;

  // valida acesso VIP
  if (item.type === 'ROLE_VIP') {
      const hasAccess =
        member.roles.cache.has(TGG_COINS_ROLES.VIP) ||
        member.roles.cache.has(TGG_COINS_ROLES.BOOSTER);

    if (!hasAccess) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Acesso negado',
            'Você precisa ser VIP ou Booster para comprar este item.'
          )
        ]
      });
    }
  }

  const roles = await tggCoins.getShopRolesByShopId(item.id);

  if (!roles.length) {
    return message.reply({
      embeds: [createErrorEmbed('Erro', 'Nenhum cargo configurado para este item.')]
    });
  }

  const currentRole = roles.find(r => member.roles.cache.has(r.role_id));

  const options = roles.slice(0, 25).map(r => ({
    label: currentRole && r.role_id === currentRole.role_id
      ? `${r.name} (Atual)`
      : r.name,
    value: String(r.role_id)
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`role_${item.type.toLowerCase()}_${item.id}`)
    .setPlaceholder('Escolha sua cor')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);

  const msg = await message.reply({
    content: `Escolha um cargo para **${item.name}**:`,
    components: [row]
  });

  const collector = msg.createMessageComponentCollector({
    time: 60000
  });

  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== discordId) {
      return interaction.reply({
        content: 'Você não pode usar isso.',
        ephemeral: true
      });
    }

  const selectedRoleId = interaction.values[0];

  const currentRoleNow = roles.find(r => member.roles.cache.has(r.role_id));

  if (currentRoleNow && String(currentRoleNow.role_id) === String(selectedRoleId)) {
    return interaction.reply({
      embeds: [createErrorEmbed('Erro', 'Você já está usando essa cor.')],
      ephemeral: true
    });
  }

  const balanceNow = await tggCoins.getBalance(discordId);

  if (balanceNow < finalPrice) {
    return interaction.reply({
      embeds: [createErrorEmbed('Saldo insuficiente', 'Você não tem saldo suficiente.')],
      ephemeral: true
    });
  }

  try {
    for (const r of roles) {
      if (member.roles.cache.has(r.role_id)) {
        await member.roles.remove(r.role_id);
      }
    }

    await member.roles.add(selectedRoleId);

    await tggCoins.addTransaction(discordId, -finalPrice, 'SHOP_PURCHASE', `Cargo: ${item.name}`);
    const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

    await tggCoins.createPurchase(discordId, item);
    await tggCoins.decreaseStock(item.id, item.stock);

    const actionText = currentRoleNow ? 'substituiu sua cor' : 'adquiriu um cargo';

    await interaction.update({
      embeds: [
        createSuccessEmbed(
          'Cargo atualizado!',
          `Você ${actionText} de **${item.name}**.\nSaldo atual: **${newBalance}**`
        )
      ],
      components: []
    });

    collector.stop();

    } catch (err) {
      return interaction.reply({
        embeds: [createErrorEmbed('Erro', err.message)],
        ephemeral: true
      });
    }
  });

  return;
}

// Para os Cargos RDM
export async function handleBuyRoleTableMaster(ctx) {
  const { message, item, discordId, finalPrice, member } = ctx;

  try {
    // Impede comprar se já tem o cargo
    if (member.roles.cache.has(item.role_id)) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Você já possui este cargo.')]
      });
    }

    // Busca quem atualmente tem o cargo
    const currentHolder = message.guild.members.cache.find(m =>
      m.roles.cache.has(item.role_id)
    );

    // Remove de quem tem atualmente
    if (currentHolder) {
      await currentHolder.roles.remove(item.role_id);
    }

    // Dá o cargo para quem comprou
    await member.roles.add(item.role_id);

    // Finaliza a compra
    await tggCoins.addTransaction(discordId, -finalPrice, 'SHOP_PURCHASE', `Cargo RDM: ${item.name}`);
    const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

    await tggCoins.createPurchase(discordId, item);
    await tggCoins.decreaseStock(item.id, item.stock);

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'Cargo adquirido!',
          `Você agora possui **${item.name}**.\nSaldo atual: **${newBalance}**`
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro ao aplicar cargo', err.message)]
    });
  }
}

// Para itens que são cargos
export async function handleBuyRole(ctx) {
  const { message, item, discordId, finalPrice, member } = ctx;

  try {
    await member.roles.add(item.role_id);

    // Finalizar a compra
    await tggCoins.addTransaction(discordId, -finalPrice, 'SHOP_PURCHASE', `Cargo: ${item.name}`);
    const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

    await tggCoins.createPurchase(discordId, item);
    await tggCoins.decreaseStock(item.id, item.stock);

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'Compra realizada!',
          `Você recebeu o cargo **${item.name}**.\nSaldo atual: **${newBalance}**`
        )
      ]
    });

  } catch (err) {
    console.error(err);

    return message.reply({
      embeds: [createErrorEmbed('Erro ao adicionar cargo', err.message)]
    });
  }
}

// Para itens tipo EXITLAG
export async function handleBuyExitlag(ctx) {
  const { message, item, discordId, finalPrice } = ctx;

  try {
    // Busca código disponível
    const code = await tggCoins.getAvailableExitlagCode();

    if (!code) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Sem estoque',
            'Não há códigos disponíveis no momento.'
          )
        ]
      });
    }

    // Tenta enviar DM primeiro
    try {
      await message.author.send({
        embeds: [
          createSuccessEmbed(
            'Seu código ExitLag',
            `Aqui está seu código de **${item.name}**:\n\n\`${code.code}\`\n\nAproveite!`
          )
        ]
      });

    } catch (err) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'DM bloqueada',
            'Não consegui enviar mensagem privada para você.\nAbra sua DM e tente novamente.'
          )
        ]
      });
    }

    // Finaliza compra
    await tggCoins.addTransaction(discordId, -finalPrice, 'SHOP_PURCHASE', `ExitLag: ${item.name}`);
    const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

    await tggCoins.createPurchase(discordId, item);
    await tggCoins.decreaseStock(item.id, item.stock);

    // Marca código como usado
    await tggCoins.markExitlagCodeAsUsed(code.id, discordId);

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'Compra realizada!',
          `Seu código foi enviado na DM.\nSaldo atual: **${newBalance}**`
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro', err.message)]
    });
  }
}

// Mapa de handlers
export const buyHandlers = {
    SERVICE: handleBuyService,
    MUTE: handleBuyMute,
    SERVER: handleBuyServer,
    ROLE_REGULAR: handleBuyRoleColor,
    ROLE_VIP: handleBuyRoleColor,
    ROLE_TABLE_MASTER: handleBuyRoleTableMaster,
    ROLE: handleBuyRole,
    EXITLAG: handleBuyExitlag
};


// Handlers pra conquistas

// Configurações para cada tipo de missão
export const typeConfig = {
  ELO: {
    icon: '🏆',
    getCurrent: c => c.elo,
    getInitial: i => i.initial_elo,
    getProgress: (c, i) => c.elo, // absoluto
    format: (target, extra) => `Alcançar **${target} de elo ${extra}**`
  },
  WINS: {
    icon: '🥇',
    getCurrent: c => c.wins,
    getInitial: i => i.initial_wins,
    getProgress: (c, i) => c.wins - i.initial_wins,
    format: target => `Ganhar **${target} partidas**`
  },
  GAMES: {
    icon: '🎮',
    getCurrent: c => c.games,
    getInitial: i => i.initial_games,
    getProgress: (c, i) => c.games - i.initial_games,
    format: target => `Jogar **${target} partidas**`
  }
};

// Gera o header da missão com base no índice, modo e recompensa
export function buildHeader(index, mode, reward, hasEvent = false) {
  const rewardText = hasEvent
    ? `${reward} TGG Coins ${EMOJIS.TGGcoin} + ${reward} Tickets ${EMOJIS.tickets}`
    : `${reward} TGG Coins ${EMOJIS.TGGcoin}`;

  return `**${index}. ${mode} (${rewardText})**\n`;
}

// Gera o texto completo da missão, verificando progresso e conclusão
export async function buildMissionText({tierMissions, mode, type, allStats, user, discordId, groupIndex }) {
  const config = typeConfig[type];
  const fields = tggCoins.getModeFields(mode);

  const extraHint =
    mode === 'Ranked 2v2' ? 'no elo de time (Team Rating)' : '';

  const { week_start } = tierMissions[0];
  if (!week_start) return '';

  const activeEvent = await tggCoins.getActiveEvent();

  const accountIds = await tggCoins.getAllAccounts(user.brawlhalla_id);
  const progressRows = await tggCoins.getPlayerMissionProgress(accountIds, week_start );

  const row = progressRows[0] || {};

  let initial_elo = 0;
  let initial_games = 0;
  let initial_wins = 0;

  for (const row of progressRows) {
    const elo = row?.[fields.elo] || 0;
    const games = row?.[fields.games] || 0;
    const wins = row?.[fields.wins] || 0;

    if (elo > initial_elo) {
      initial_elo = elo;
    }

    initial_games += games;
    initial_wins += wins;
  }

  const initial = { initial_elo, initial_games, initial_wins };

  let current_elo = 0;
  let current_games = 0;
  let current_wins = 0;

  for (const stats of allStats) {
    const data = tggCoins.extractModeData(stats, mode);

    if (data.elo > current_elo) {
      current_elo = data.elo;
    }

    current_games += data.games;
    current_wins += data.wins;
  }

  const current = { elo: current_elo, games: current_games, wins: current_wins };
  const progressValue = config.getProgress(current, initial);

  // Missões de 1 tier
  if (tierMissions.length === 1) {
    const m = tierMissions[0];

    let text = buildHeader(groupIndex, mode, m.reward, !!activeEvent);
    text += `${config.icon} ${config.format(m.target, extraHint)}\n`;

    const result = tggCoins.checkMissionCompletion({
      type,
      ...initial,
      final_elo: current.elo,
      final_games: current.games,
      final_wins: current.wins,
      target: m.target
    });

    const done = await tggCoins.hasCompletedMission(discordId, m.id);

    if (result.completed) {
      if (!done) {
        await tggCoins.completeMission(discordId, m);

        text += activeEvent
          ? `✅ Concluído (+${m.reward} coins | +${m.reward} tickets)\n\n`
          : `✅ Concluído (+${m.reward} coins)\n\n`;

      } else {
        text += `✅ Concluído\n\n`;
      }
    } else {
      text += `Progresso: ${progressValue} / ${m.target}\n`;
      text += `⏳ Em progresso\n`;
      if (result.tip) text += `${result.tip}\n`;
      text += `\n`;
    }

    return text;
  }

  // Missões de múltiplos tiers (ex: games)
  let currentTier = 0;
  let rewards = [];

  for (let i = 0; i < tierMissions.length; i++) {
    const tier = tierMissions[i];

    const result = tggCoins.checkMissionCompletion({
      type,
      ...initial,
      final_elo: current.elo,
      final_games: current.games,
      final_wins: current.wins,
      target: tier.target
    });

    const done = await tggCoins.hasCompletedMission(discordId, tier.id);

    if (result.completed) {
      if (!done) {
        await tggCoins.completeMission(discordId, tier);
        rewards.push(tier.reward);
      }
      currentTier = i + 1;
    }
  }

  const currentMission =
    tierMissions[currentTier] ||
    tierMissions[tierMissions.length - 1];

  let text = buildHeader(groupIndex, mode, currentMission.reward, !!activeEvent);
  text += `${config.icon} ${config.format(currentMission.target, extraHint)}\n`;

  text += `Progresso: ${progressValue} / ${currentMission.target}\n`;
  text += `Tier: ${currentTier} / ${tierMissions.length}\n`;

  if (rewards.length) {
    text += `💰 +${rewards.join(' +')} coins\n`;

    if (activeEvent) {
      text += `${EMOJIS.tickets} +${rewards.join(' +')} tickets\n`;
    }
  }

  text +=
    currentTier === tierMissions.length
      ? `✅ Concluído\n\n`
      : `⏳ Em progresso\n\n`;

  return text;
}


// Handlers para Daily

export function getDailyReward(streak) {
  if (streak >= 7) {
    return {
      reward: 100,
      message: `🔥 Streak de ${streak} dias! Recompensa máxima!`
    };
  }

  if (streak >= 3) {
    return {
      reward: 75,
      message: `🔥 Streak de ${streak} dias! Continue assim!`
    };
  }

  return {
    reward: 50,
    message: `📅 Streak de ${streak} dia${streak > 1 ? 's' : ''}`
  };
}


// Handlers pro quiz

// Premiação em TGG Coins
export const QUIZ_REWARD = 150;

// Letras para as opções do quiz
export const OPTION_LETTERS = ['A', 'B', 'C'];

// Perguntas do quiz
export const quizQuestions = [
  {
    question: 'Como você ajuda a guilda?',
    options: [
      {
        text: 'Fazendo missões e jogando com membros da guilda',
        correct: true
      },

      {
        text: 'Jogando partidas casuais sozinho',
        correct: false
      },

      {
        text: 'Jogando modos competitivos sozinho',
        correct: false
      }
    ]
  },

  {
    question: 'Qual o mínimo de contribuição semanal?',
    options: [
      {
        text: '100',
        correct: false
      },

      {
        text: '5.000',
        correct: false
      },

      {
        text: '1.000',
        correct: true
      }
    ]
  },

  {
    question: 'Como funcionam as Guild Battles?',
    options: [
      {
        text: 'Quando enfrento outro jogador de outra guilda',
        correct: false
      },

      {
        text: 'Com um membro da TGG, enfrentamos dois jogadores de outra guilda',
        correct: true
      },

      {
        text: 'Com um membro de outra guilda, enfrentamos dois jogadores de outra guilda',
        correct: false
      }
    ]
  },

  {
    question: 'O que fazer quando estiver com dúvidas?',
    options: [
      {
        text: 'Abrir um ticket no canal <#1461132037908856964>',
        correct: true
      },

      {
        text: 'Marcar a staff no canal <#1437416481343406122>',
        correct: false
      },

      {
        text: 'Perguntar para outros membros no canal <#1437416481343406122>',
        correct: false
      }
    ]
  },

  {
    question: 'Qual a diferença entre XP e Contribuição?',
    options: [
      {
        text: 'Ambos são a mesma coisa, ganho contribuição jogando partidas',
        correct: false
      },

      {
        text: 'XP é ganho com as missões e contribuição é ganho jogando partidas',
        correct: false
      },

      {
        text: 'XP se ganha jogando partidas, contribuição se ganha com missões e guild battles',
        correct: true
      }
    ]
  },

  {
    question: 'Qual o período das missões semanais?',
    options: [
      {
        text: 'Segunda-feira 6am até Domingo 6am',
        correct: false
      },

      {
        text: 'Domingo 6am até Sábado 6am',
        correct: false
      },

      {
        text: 'Quinta-feira 6am até Quarta-feira 6am',
        correct: true
      }
    ]
  },

  {
    question: 'Como você se torna membro (Patente prateada) da guilda?',
    options: [
      {
        text: 'Pegando 40k de contribuição total',
        correct: true
      },

      {
        text: 'Pegando 20k de contribuição total',
        correct: false
      },

      {
        text: 'Pegando 10k de contribuição semanal',
        correct: false
      }
    ]
  },

  {
    question: 'O que são Guild Tokens?',
    options: [
      {
        text: 'Moeda da guilda que permite comprar itens na loja da guilda in-game',
        correct: true
      },

      {
        text: 'Total de contribuição que um membro tem na guilda',
        correct: false
      },

      {
        text: 'Quantidade de duelos vencidos em Guild Battles',
        correct: false
      }
    ]
  },

  {
    question: 'Como conseguir Guild Tokens?',
    options: [
      {
        text: 'Fazendo as missões da guilda e participando das Guild Battles',
        correct: true
      },

      {
        text: 'Enfrentar algum membro da guilda rival em partidas ranqueadas',
        correct: false
      },

      {
        text: 'Pegando 1.000 de contribuição semanal',
        correct: false
      }
    ]
  },

  {
    question: 'Como fazer para virar MVP Semanal?',
    options: [
      {
        text: 'Ficar entre os 14 melhores membros em contribuição semanal (Sem contar officers)',
        correct: true
      },

      {
        text: 'Pegar 5.000 de contribuição semanal',
        correct: false
      },

      {
        text: 'Conversar no server e ajudar os outros membros',
        correct: false
      }
    ]
  }
];

// Função para embaralhar as opções do quiz
export function shuffleArray(array) {
  return [...array].sort(() => Math.random() - 0.5);
}