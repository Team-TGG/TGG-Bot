// Comandos da TGG-Coins
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { addTransaction, updateBalance, getLastDaily, getBalance, getTransactions, getLeaderboard, getShopItems, getShopCount, getShopItemByPosition, hasPurchased, createPurchase, decreaseStock } from './tggCoins.js';
import { getUserByDiscordId } from './db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from '../utils/discordUtils.js';
import { EMOJIS } from '../config/emojis.js';

// ---- .daily ----
export async function handleDaily(message) {
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
          `+${reward} TGG-Coins ${EMOJIS.TGGcoin}\nSaldo atual: **${newBalance}**`
        )
      ]
    });

  } catch (err) {
    return loading.edit({
      embeds: [createErrorEmbed('Erro no daily', err.message)]
    });
  }
}

// ---- .balance ----
export async function handleBalance(message) {
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
          .setTitle(`${EMOJIS.TGGcoin} Seu saldo`)
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

// ---- .historico ----
export async function handleHistorico(message) {
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

// ---- .leaderboard ----
export async function handleLeaderboard(message) {
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

// ---- .shop ----
export async function handleShop(message, args) {
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
          value: `${item.description || 'Sem descrição'}\n${EMOJIS.TGGcoin} **${item.price} TGG-Coins**${extra}`,
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

// ---- .buy ----
export async function handleBuy(message, args) {
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
