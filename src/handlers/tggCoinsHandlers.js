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

// Mapa de handlers
export const buyHandlers = {
    SERVICE: handleBuyService,
    MUTE: handleBuyMute,
    SERVER: handleBuyServer,
    ROLE_REGULAR: handleBuyRoleColor,
    ROLE_VIP: handleBuyRoleColor,
    ROLE_TABLE_MASTER: handleBuyRoleTableMaster,
    ROLE: handleBuyRole
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
export function buildHeader(index, mode, reward) {
  return `**${index}. ${mode} (${reward}${EMOJIS.TGGcoin})**\n`;
}

// Gera o texto completo da missão, verificando progresso e conclusão
export async function buildMissionText({tierMissions, mode, type, stats, user, discordId, groupIndex }) {
  const config = typeConfig[type];
  const fields = tggCoins.getModeFields(mode);

  const extraHint =
    mode === 'Ranked 2v2' ? 'no elo de time (Team Rating)' : '';

  const { week_start } = tierMissions[0];
  if (!week_start) return '';

  const progress = await tggCoins.getPlayerMissionProgress(
    user.brawlhalla_id,
    week_start
  );

  const row = progress[0] || {};

  const initial = {
    initial_elo: row?.[fields.elo] || 0,
    initial_games: row?.[fields.games] || 0,
    initial_wins: row?.[fields.wins] || 0
  };

  const current = tggCoins.extractModeData(stats, mode);
  const progressValue = config.getProgress(current, initial);

  // Missões de 1 tier
  if (tierMissions.length === 1) {
    const m = tierMissions[0];

    let text = buildHeader(groupIndex, mode, m.reward);
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
        text += `✅ Concluído (+${m.reward} coins)\n\n`;
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

  let text = buildHeader(groupIndex, mode, currentMission.reward);
  text += `${config.icon} ${config.format(currentMission.target, extraHint)}\n`;

  text += `Progresso: ${progressValue} / ${currentMission.target}\n`;
  text += `Tier: ${currentTier} / ${tierMissions.length}\n`;

  if (rewards.length) {
    text += `💰 +${rewards.join(' +')} coins\n`;
  }

  text +=
    currentTier === tierMissions.length
      ? `✅ Concluído\n\n`
      : `⏳ Em progresso\n\n`;

  return text;
}