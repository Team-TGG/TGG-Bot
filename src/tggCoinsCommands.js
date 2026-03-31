// Comandos da TGG-Coins
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { addTransaction, updateBalance, getLastDaily, getBalance, getTransactions, getLeaderboard, getShopItems, getShopCount, getShopItemByPosition, hasPurchased, createPurchase, decreaseStock } from './tggCoins.js';
import { getUserByDiscordId } from './db.js';

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

const EMOJIS = {
  loading: '<a:loading:1475807230899867709>',
  coin: '<:coin:1475807196169695282>'
};

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
          `+${reward} TGG-Coins 💰\nSaldo atual: **${newBalance}**`
        )
      ]
    });

  } catch (err) {
    console.error('Error in daily:', err);
    return loading.edit({
      embeds: [
        createErrorEmbed('Erro ao resgatar daily', err.message)
      ]
    });
  }
}

// ---- .balance ----
export async function handleBalance(message, args) {
  try {
    const discordId = message.author.id;

    // Obtém saldo de outra pessoa
    let targetId = discordId;
    if (args.length > 0) {
      const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
      if (mentionMatch) {
        targetId = mentionMatch[1];
      } else if (/^\d+$/.test(args[0])) {
        targetId = args[0];
      }
    }

    const balance = await getBalance(targetId);
    const targetUser = targetId === discordId ? 'Você' : `<@${targetId}>`;

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.coin} Saldo de TGG-Coins`)
          .setDescription(`${targetUser} possui **${balance}** TGG-Coins`)
          .setTimestamp()
      ]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro', err.message)] });
  }
}

// ---- .historico ----
export async function handleHistorico(message) {
  try {
    const discordId = message.author.id;

    let page = 1;
    const limit = 5;

    async function generateEmbed(page) {
      const { data, total } = await getTransactions(discordId, page, limit);

      const totalPages = Math.ceil(total / limit) || 1;

      if (data.length === 0) {
        return new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('Sem transações');
      }

      const description = data.map((tx) => {
        const emoji = tx.amount >= 0 ? '🟢' : '🔴';
        const date = new Date(tx.created_at).toLocaleDateString('pt-BR');
        return `${emoji} **${tx.amount > 0 ? '+' : ''}${tx.amount}** - ${tx.type} (${date})\n${tx.description}`;
      }).join('\n\n');

      return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${EMOJIS.coin} Histórico de Transações`)
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

    const collector = msg.createMessageComponentCollector({ time: 60000 });

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

    const collector = msg.createMessageComponentCollector({ time: 60000 });

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

    // Vai para a última página existente
    if (page > totalPages) page = totalPages;

    async function generateEmbed(page) {
      const { data } = await getShopItems(page, limit);

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`${EMOJIS.coin} Loja de Itens`)
        .setDescription('Use `.buy [posição]` para comprar um item')
        .setFooter({ text: `Página ${page}/${totalPages}` });

      data.forEach((item, index) => {
        const globalIndex = (page - 1) * limit + index + 1;
        embed.addFields({
          name: `${globalIndex}. ${item.name} - ${item.price} ${EMOJIS.coin}`,
          value: `${item.description}\nEstoque: ${item.stock || '∞'}`,
          inline: false
        });
      });

      return embed;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('shop_prev')
        .setLabel('⬅️ Anterior')
        .setStyle(2)
        .setDisabled(page <= 1),

      new ButtonBuilder()
        .setCustomId('shop_next')
        .setLabel('Próxima ➡️')
        .setStyle(2)
        .setDisabled(page >= totalPages)
    );

    const msg = await message.reply({
      embeds: [await generateEmbed(page)],
      components: [row]
    });

    const collector = msg.createMessageComponentCollector({ time: 120000 });

    collector.on('collect', async (interaction) => {
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ content: 'Você não pode usar isso.', ephemeral: true });
      }

      if (interaction.customId === 'shop_prev') page--;
      if (interaction.customId === 'shop_next') page++;

      await interaction.update({
        embeds: [await generateEmbed(page)],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('shop_prev')
              .setLabel('⬅️ Anterior')
              .setStyle(2)
              .setDisabled(page <= 1),
            new ButtonBuilder()
              .setCustomId('shop_next')
              .setLabel('Próxima ➡️')
              .setStyle(2)
              .setDisabled(page >= totalPages)
          )
        ]
      });
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro na Loja', err.message)]
    });
  }
}

// ---- .buy ----
export async function handleBuy(message, args) {
  try {
    if (args.length === 0) {
      return message.reply({
        embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.buy [posição]`')]
      });
    }

    const discordId = message.author.id;

    // Verifica se usuário está na guild
    const user = await getUserByDiscordId(discordId);
    if (!user || !user.active) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Você não está na guilda.')]
      });
    }

    const position = parseInt(args[0]);
    if (isNaN(position) || position < 1) {
      return message.reply({
        embeds: [createErrorEmbed('Posição Inválida', 'Use `.buy [posição]`')]
      });
    }

    // Busca o item pela posição
    const item = await getShopItemByPosition(position);
    if (!item) {
      return message.reply({
        embeds: [createErrorEmbed('Item Não Encontrado', 'Este item não existe na loja.')]
      });
    }

    // Verifica estoque
    if (item.stock !== null && item.stock <= 0) {
      return message.reply({
        embeds: [createErrorEmbed('Estoque Esgotado', 'Este item está esgotado.')]
      });
    }

    // Verifica saldo
    const balance = await getBalance(discordId);
    if (balance < item.price) {
      return message.reply({
        embeds: [createErrorEmbed('Saldo Insuficiente', `Você precisa de ${item.price} TGG-Coins. Seu saldo: ${balance}`)]
      });
    }

    // Verifica se já comprou (se for único)
    if (item.unique) {
      const alreadyHas = await hasPurchased(discordId, item.id);
      if (alreadyHas) {
        return message.reply({
          embeds: [createErrorEmbed('Item Único', 'Você já possui este item.')]
        });
      }
    }

    // Realiza a compra
    await addTransaction(discordId, -item.price, 'PURCHASE', `Compra: ${item.name}`);
    await updateBalance(discordId, -item.price);
    await createPurchase(discordId, item.id);

    // Diminui estoque se houver
    if (item.stock !== null) {
      await decreaseStock(item.id);
    }

    await message.reply({
      embeds: [
        createSuccessEmbed(
          'Compra Realizada!',
          `Você comprou **${item.name}** por ${item.price} TGG-Coins\n${item.description}`
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro na Compra', err.message)]
    });
  }
}
