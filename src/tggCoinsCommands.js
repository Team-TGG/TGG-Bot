// Comandos da TGG-Coins
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle } from 'discord.js';
import * as tggCoins from './tggCoins.js';
import { getUserByDiscordId, getMissionWeekStart, formatDateBR, getMissionWeekEnd, resolveBrawlhallaId, loadAliases } from './db.js';
import { fetchPlayerStats } from './brawlhalla.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from '../utils/discordUtils.js';
import { adminOnly, leaderOnly, ROLE_HIERARCHY } from '../utils/permissions.js';
import { EMOJIS } from '../config/emojis.js';
import { STAFF_ROLE_IDS } from '../config/index.js';
import { buyHandlers, typeConfig, buildHeader, buildMissionText } from './handlers/tggCoinsHandlers.js';

// Cargos relacionados às TGG-Coins (IDs dos cargos no Discord)
export const TGG_COINS_ROLES = {
  MVP_SEMANAL:  '1448466041997889769',  // MVP Semanal
  VIP:          '1490462353995731054',  // VIP
  BOOSTER:      '1437560273031528470'   // Booster
};

// Funções auxiliares

// Função pra rodar o daily normalmente, também é chamada quando o usuário recupera a streak, para evitar duplicação de código
async function runDaily(target, member, discordId, streak, recovered) {
  let reward = 50;
  let streakMessage = '';

  if (streak >= 7) {
    reward = 100;
    streakMessage = `🔥 Streak de ${streak} dias! Recompensa máxima!`;
  } else if (streak >= 3) {
    reward = 75;
    streakMessage = `🔥 Streak de ${streak} dias! Continue assim!`;
  } else {
    reward = 50;
    streakMessage = `📅 Streak de ${streak} dia${streak > 1 ? 's' : ''}`;
  }

  if (recovered) {
    streakMessage += `\n💸 Streak recuperada por 200 moedas!`;
  }

  let multiplier = 1;
  let bonusDetails = [];

  if (member.roles.cache.has(TGG_COINS_ROLES.MVP_SEMANAL)) {
    multiplier += 0.4;
    bonusDetails.push('✨ MVP Semanal (+40%)');
  }

  if (member.roles.cache.has(TGG_COINS_ROLES.VIP)) {
    multiplier += 0.2;
    bonusDetails.push('💎 VIP (+20%)');
  }

  const original = reward;
  reward = Math.floor(reward * multiplier);
  const bonus = reward - original;

  let bonusMessage = '';
  if (bonus > 0) {
    bonusMessage = `\n${bonusDetails.join('\n')}\n💰 Bônus total: +${bonus} TGG-Coins`;
  }

  await tggCoins.upsertUserStreak(discordId, streak);
  await tggCoins.addTransaction(discordId, reward, 'DAILY', 'Recompensa diária');
  const newBalance = await tggCoins.updateBalance(discordId, reward);

  const replyMethod = typeof target.update === 'function'
    ? target.update.bind(target)
    : target.edit.bind(target);

  return replyMethod({
    embeds: [
      createSuccessEmbed(
        'TGG Coins recebidas!',
        `+${reward} TGG-Coins ${EMOJIS.TGGcoin}\n${streakMessage}${bonusMessage}\n\nSaldo atual: **${newBalance.toLocaleString('pt-BR')}**`
      )
    ],
    components: []
  });
}

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
    const lastDaily = await tggCoins.getLastDaily(discordId);
    const streakData = await tggCoins.getUserStreak(discordId); // Pega a streak atual do usuário

    const now = new Date();

    let streak = 1;
    let recovered = false;

    const RECOVERY_COST = 300;

    if (lastDaily) {
      const last = new Date(lastDaily.created_at);
      const diffMs = now - last;
      const diffHours = diffMs / (1000 * 60 * 60);

      // Bloquear resgate se ainda não tiver passado 24h do último daily
      if (diffMs < 24 * 60 * 60 * 1000) {
        const remainingMs = (24 * 60 * 60 * 1000) - diffMs;

        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
        const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

        return loading.edit({
          embeds: [
            createErrorEmbed(
              'Daily já resgatado',
              `Volte em ${hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`}.`
            )
          ]
        });
      }

      if (diffHours <= 48) {
        streak = (streakData?.streak || 1) + 1;
      }

      // Se perdeu streak em até 72h, pode recuperar
      else {
        const canRecover = diffHours <= 72;

        if (canRecover && streakData?.streak > 0) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`recover_${discordId}`)
              .setLabel('Recuperar streak')
              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
              .setCustomId(`skip_${discordId}`)
              .setLabel('Ignorar')
              .setStyle(ButtonStyle.Secondary)
          );

          await loading.edit({
            embeds: [
              createErrorEmbed(
                'Streak perdida!',
                `Você perdeu sua streak de **${streakData.streak} dia(s)**.\n\nDeseja recuperar por **${RECOVERY_COST} moedas**?`
              )
            ],
            components: [row]
          });

          const filter = i => i.user.id === discordId;
          const collector = loading.createMessageComponentCollector({
            filter,
            time: 30000,
            max: 1
          });

          collector.on('collect', async (interaction) => {
            let finalStreak = 1;

            if (interaction.customId.startsWith('recover')) {
              const balance = await tggCoins.getBalance(discordId);

              if (balance >= RECOVERY_COST) {
                await tggCoins.addTransaction(
                  discordId,
                  -RECOVERY_COST,
                  'STREAK_RECOVERY',
                  'Recuperação de streak'
                );

                await tggCoins.updateBalance(discordId, -RECOVERY_COST);

                finalStreak = (streakData?.streak || 1) + 1;
                recovered = true;
              }
            }

            await runDaily(interaction, message.member, discordId, finalStreak, recovered);
          });

          collector.on('end', async (collected) => {
            if (collected.size === 0) {
              await loading.edit({
                embeds: [createErrorEmbed('Tempo esgotado', 'Você não respondeu a tempo.')],
                components: []
              });
            }
          });

          return;
        }

        // Reset normal
        streak = 1;
      }
    }

    // Fluxo normal da função
    return runDaily(loading, message.member, discordId, streak, recovered);

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

    const balance = await tggCoins.getBalance(discordId);

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.TGGcoin} Seu saldo`)
          .setDescription(`Você possui **${balance.toLocaleString('pt-BR')} TGG-Coins**`)
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
    const limit = 5;

    async function generateEmbed(page) {
      const { data, total } = await tggCoins.getTransactions(discordId, page, limit);

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

        return `**${sinal}${Math.abs(t.amount).toLocaleString('pt-BR')}** | ${t.description}\n${date}`;
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

    let { total } = await tggCoins.getTransactions(discordId, page, limit);
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

      let { total } = await tggCoins.getTransactions(discordId, page, limit);
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
      const { data, total } = await tggCoins.getLeaderboard(page, limit);

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

          return `${medal} **${username}** — ${user.balance.toLocaleString('pt-BR')} TGG-Coins`;
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

    let { total } = await tggCoins.getLeaderboard(page, limit);
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

      let { total } = await tggCoins.getLeaderboard(page, limit);
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

// Estado temporário para a loja (Cada usuário tem seu próprio index de loja)
const shopState = new Map();
const SHOP_STATE_TTL = 2 * 60 * 1000; // Expira em 2 minutos

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

    const member = await message.guild.members.fetch(discordId);

    const limit = 5;

    const categoryNames = {
      GERAL: '📦 Geral',
      CARGOS: '🎭 Cargos',
      SERVICOS: '🛠️ Serviços'
    };

    let category = 'GERAL';
    let page = 1;

    const allItems = await tggCoins.getShopItems(1, 9999);

    function getFiltered() {
      const filtered = allItems.data.filter(item => {
        if (tggCoins.getCategory(item.type) !== category) return false;

        if (item.type === 'ROLE_VIP') {
          return member.roles.cache.has(TGG_COINS_ROLES.VIP) || member.roles.cache.has(TGG_COINS_ROLES.BOOSTER);
        }

        return true;
      });

      // Colocar itens de evento em primeiro
      return filtered.sort((a, b) => {
        if (a.type === 'EVENT' && b.type !== 'EVENT') return -1;
        if (a.type !== 'EVENT' && b.type === 'EVENT') return 1;
        return 0;
      });
    }

    function getPageItems() {
      const filtered = getFiltered();
      const start = (page - 1) * limit;
      return filtered.slice(start, start + limit);
    }

    async function generateEmbed() {
      const filtered = getFiltered();
      const totalPages = Math.ceil(filtered.length / limit) || 1;

      if (page > totalPages) page = totalPages;

      const pageItems = getPageItems();

      shopState.set(discordId, {
        category,
        items: filtered,
        createdAt: Date.now()
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🛒 Loja • ${categoryNames[category]}`)
        .setFooter({ text: `Página ${page}/${totalPages}` })
        .setTimestamp();

      // Aviso de booster na loja
      if (member.roles.cache.has(TGG_COINS_ROLES.BOOSTER)) {
        embed.setDescription('🔥 Você possui **desconto de Booster (5%)** ativo!');
      }

      // Se não tiver itens, mostra mensagem de loja vazia
      if (!pageItems.length) {
        embed.setDescription('Nenhum item nesta categoria.');
        return embed;
      }

      pageItems.forEach((item, index) => {
        const position = (page - 1) * limit + index + 1;

        let extra = '';
        if (item.is_unique) extra += ' 🔒 Único';
        if (item.stock !== null) extra += ` • Estoque: ${item.stock}`;

        const finalPrice = tggCoins.getDiscountedPrice(member, item);

        let priceText;

        if (finalPrice === 0) {
          priceText = `🆓 **Grátis para Booster**`;
        } else {
          priceText = `${EMOJIS.TGGcoin} **${finalPrice.toLocaleString('pt-BR')} TGG-Coins**`;

          if (finalPrice < item.price) {
            priceText = `~~${item.price.toLocaleString('pt-BR')}~~ → ${priceText} 🔥`;
          }
        }

        // Colocar emoji caso seja item de evento
        const emoji = item.type === 'EVENT' ? '🎉 ' : '';

        embed.addFields({
          name: `#${position} • ${emoji}${item.name}`,
          value: `${item.description || 'Sem descrição'}\n${priceText}${extra}`,
          inline: false
        });
      });

      return embed;
    }

    function getComponents(filteredLength) {
      const totalPages = Math.ceil(filteredLength / limit) || 1;

      const select = new StringSelectMenuBuilder()
        .setCustomId('shop_category')
        .setPlaceholder('📂 Escolha uma categoria')
        .addOptions([
          { label: '📦 Geral', value: 'GERAL', default: category === 'GERAL' },
          { label: '🎭 Cargos', value: 'CARGOS', default: category === 'CARGOS' },
          { label: '🛠️ Serviços', value: 'SERVICOS', default: category === 'SERVICOS' }
        ]);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('shop_prev')
          .setLabel('⬅️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 1),

        new ButtonBuilder()
          .setCustomId('shop_next')
          .setLabel('➡️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page >= totalPages)
      );

      return [
        new ActionRowBuilder().addComponents(select),
        buttons
      ];
    }

    const filteredInitial = getFiltered();

    const msg = await message.reply({
      embeds: [await generateEmbed()],
      components: getComponents(filteredInitial.length)
    });

    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async (interaction) => {
      try {
        if (interaction.user.id !== discordId) {
          return interaction.reply({
            content: 'Você não pode usar isso.',
            ephemeral: true
          });
        }

        if (interaction.customId === 'shop_category') {
          category = interaction.values[0];
          page = 1;
        }

        if (interaction.customId === 'shop_prev') {
          page--;
        }

        if (interaction.customId === 'shop_next') {
          page++;
        }

        const filtered = getFiltered();

        await interaction.update({
          embeds: [await generateEmbed()],
          components: getComponents(filtered.length)
        });

      } catch (err) {
        console.error(err);
      }
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
    const member = await message.guild.members.fetch(discordId);

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

    // Pega o estado da loja do usuário para saber quais itens ele está vendo
    const state = shopState.get(discordId);

    if (!state) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Abra a loja primeiro usando `.shop`.')]
      });
    }

    // Se a loja tiver expirado (2 minutos sem usar), remove o estado e pede para abrir a loja de novo
    if (Date.now() - state.createdAt > SHOP_STATE_TTL) {
      shopState.delete(discordId);

      return message.reply({
        embeds: [createErrorEmbed('Tempo expirado', 'Abra a loja novamente com `.shop`.')]
      });
    }

    const item = state.items[position - 1];

    if (!item) {
      return message.reply({
        embeds: [createErrorEmbed('Item não encontrado', 'Esse item não existe nessa categoria/página.')]
      });
    }

    // Preço final (verifica se o usuario tem desconto (booster) e aplica o desconto)
    const finalPrice = tggCoins.getDiscountedPrice(member, item);

    // Se for um item único
    if (item.is_unique) {
      const alreadyHas = await tggCoins.hasPurchased(discordId, item.id);
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
    const balance = await tggCoins.getBalance(discordId);

    // Se não tiver saldo suficiente, trava
    if (balance < finalPrice) {
      return message.reply({
        embeds: [createErrorEmbed('Saldo insuficiente', `Você precisa de ${finalPrice.toLocaleString('pt-BR')} TGG-Coins.`)]
      });
    }

    // Uso de Handlers para evitar uso de if/else gigante e facilitar manutenção e adição de novos tipos de item no futuro
    const ctx = {message, item, member, discordId, finalPrice};

    // Executa o handle, caso exista
    const handler = buyHandlers[item.type];

    if (handler) {
      return handler(ctx);
    }

    // Fallback para itens simples que não precisam de um tratamento específico

    // Para itens que são cargos simples
    if (item.type === 'ROLE' && item.role_id) {
      try {
        await member.roles.add(item.role_id);
      } catch (err) {
        console.error('Erro ao adicionar cargo:', err);
      }
    }

    // Adiciona a transação
    await tggCoins.addTransaction(discordId, -finalPrice, 'SHOP_PURCHASE', `Compra: ${item.name}`);

    // Atualizar o saldo
    const newBalance = await tggCoins.updateBalance(discordId, -finalPrice);

    // Registrar a compra
    await tggCoins.createPurchase(discordId, item);

    // Diminuir estoque (Se tiver estoque)
    await tggCoins.decreaseStock(item.id, item.stock);

    let priceText = `**${finalPrice.toLocaleString('pt-BR')} TGG-Coins**`;
    
    // Mensagem extra para quem comprou com desconto
    if (finalPrice < item.price) {
      priceText = `~~${item.price.toLocaleString('pt-BR')}~~ → ${priceText} 🔥 (desconto de Booster aplicado)`;
    }

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'Compra realizada!',
          `Você comprou **${item.name}** por ${priceText}.\nSaldo atual: **${newBalance}**`
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro na compra', err.message)]
    });
  }
}

// ---- .conquistas ----
export async function handleConquistas(message) {
  const loading = await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`${EMOJIS.loading} Carregando conquistas...`)
    ]
  });

  try {
    const discordId = message.author.id;
    const user = await getUserByDiscordId(discordId);

    // Garante que os aliases estão carregados
    await loadAliases();

    // Resolve o brawlhalla_id para pegar as quests da conta correta
    if (user.brawlhalla_id) {
      user.brawlhalla_id = resolveBrawlhallaId(String(user.brawlhalla_id));
    }

    if (!user) {
      return loading.edit({
        embeds: [
          createErrorEmbed('Acesso Negado', 'Você não está na guilda.')
        ]
      });
    }

    const weekStart = getMissionWeekStart();
    const weekEnd = getMissionWeekEnd();
    const missions = await tggCoins.getWeeklyMissions(weekStart, weekEnd);

    // Se não tiver missões cadastradas, mostra mensagem de erro
    if (!missions || missions.length === 0) {
      return loading.edit({
        embeds: [
          createErrorEmbed(
            'Nenhuma missão encontrada',
            'Ainda não há missões cadastradas para esta semana.'
          )
        ]
      });
    }

    const stats = await fetchPlayerStats(user.brawlhalla_id);

    // Agrupa por modo e tipo, criando tiers
    const grouped = {};
    missions.forEach(m => {
      const key = `${m.mode}_${m.type}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m);
    });

    let activeText = '';
    let index = 1;

    for (const key in grouped) {
      const tierMissions = grouped[key].sort((a, b) => a.target - b.target);
      const { mode, type } = tierMissions[0];

      activeText += await buildMissionText({tierMissions, mode, type, stats, user, discordId, groupIndex: index++ });
    }

    // Mostrar as conquistas concluídas do usuário (histórico)
    const history = await tggCoins.getUserAchievements(discordId);
    const pageSize = 3;
    let currentPage = 0;

    function buildHistory(page) {
      if (!history?.length) {
        return 'Nenhuma missão concluída ainda.';
      }

      const start = page * pageSize;
      const slice = history.slice(start, start + pageSize);

      let text = '';

      slice.forEach((item, i) => {
        const mission = item.tgg_coins_achievements;
        if (!mission) return;

        const index = start + i;
        const config = typeConfig[mission.type];

        text += `**${index + 1}. ${mission.mode}**\n`;

        if (mission.type === 'ELO') {
          text += `${config.icon} Alcançou **${mission.target} de elo**\n`;
        } else {
          text += `${config.icon} ${config.format(mission.target)}\n`;
        }

        text += `💰 +${item.coins_earned} coins\n`;

        if (item.completed_at) {
          const date = item.completed_at.split('T')[0];
          text += `📅 ${formatDateBR(date)}\n`;
        }

        text += `\n`;
      });

      return text;
    }

    // Embeds
    function historyEmbed() {
      return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🏆 Missões Concluídas')
        .setDescription(buildHistory(currentPage))
        .setFooter({
          text: `Página ${currentPage + 1} de ${Math.max(1, Math.ceil((history?.length || 0) / pageSize))}`
        });
    }

    const activeEmbed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle('🎯 Missões da Semana')
      .setDescription(activeText || 'Nenhuma missão ativa.')
      .setFooter({
        text: `Semana iniciada em ${formatDateBR(weekStart)}`
      });

    const mainRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('active').setLabel('🎯 Ativas').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('history').setLabel('🏆 Concluídas').setStyle(ButtonStyle.Primary)
    );

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev').setLabel('⬅️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('next').setLabel('➡️').setStyle(ButtonStyle.Secondary)
    );

    const msg = await loading.edit({
      embeds: [activeEmbed],
      components: [mainRow]
    });

    const collector = msg.createMessageComponentCollector({
      time: 60000
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== discordId) {
        return i.reply({ content: 'Você não pode usar isso.', ephemeral: true });
      }

      if (i.customId === 'active') {
        await i.update({ embeds: [activeEmbed], components: [mainRow] });
      }

      if (i.customId === 'history') {
        currentPage = 0;
        await i.update({ embeds: [historyEmbed()], components: [mainRow, navRow] });
      }

      if (i.customId === 'next') {
        currentPage++;
        await i.update({ embeds: [historyEmbed()], components: [mainRow, navRow] });
      }

      if (i.customId === 'prev') {
        currentPage--;
        await i.update({ embeds: [historyEmbed()], components: [mainRow, navRow] });
      }
    });

  } catch (err) {
    return loading.edit({
      embeds: [
        createErrorEmbed('Erro ao carregar conquistas', err.message)
      ]
    });
  }
}

// ---- .streak ----
export async function handleStreak(message) {
  try {
    const discordId = message.author.id;

    const streakData = await tggCoins.getUserStreak(discordId);
    const streak = streakData?.streak || 0;

    let nextBonus = null;
    let daysLeft = null;

    if (streak < 3) {
      nextBonus = 75;
      daysLeft = 3 - streak;
    } else if (streak < 7) {
      nextBonus = 100;
      daysLeft = 7 - streak;
    }

    let description = `Você está com **${streak} dia(s)** de streak.`;

    if (nextBonus !== null) {
      description += `\n\n⏳ Faltam **${daysLeft} dia(s)${daysLeft > 1 ? 's' : ''}** para o próximo bônus de **${nextBonus} moedas**.`;
    } else {
      description += `\n\n🏆 Você já atingiu o bônus máximo de **100 moedas**!`;
    }

    return message.reply({
      embeds: [
        createSuccessEmbed(
          '🔥 Sua Streak',
          description
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro', err.message)]
    });
  }
}

// ---- .addcoins (líder) ----
export const handleAddCoins = leaderOnly(async (message, args, client) => {
  const loading = await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle('💰 Adicionando moedas...')
    ]
  });

  try {
    const target = message.mentions.users.first();
    if (!target) {
      return loading.edit({
        embeds: [createErrorEmbed('Erro', 'Mencione um usuário.')]
      });
    }

    const targetId = target.id;

    // Junta tudo depois do comando original
    const fullContent = message.content;

    // Regex pra pegar tipo + "descrição" + quantidade
    const match = fullContent.match(/\.addcoins\s+<@!?\d+>\s+(\w+)\s+"([^"]+)"\s+(-?\d+)/i);

    if (!match) {
      return loading.edit({
        embeds: [
          createErrorEmbed(
            'Formato inválido',
            'Use:\n`.addcoins @usuario TIPO "descrição" quantidade`'
          )
        ]
      });
    }

    let [, type, description, amount] = match;

    type = type.toUpperCase();
    amount = parseInt(amount);

    if (isNaN(amount)) {
      return loading.edit({
        embeds: [createErrorEmbed('Erro', 'Quantidade inválida.')]
      });
    }

    // Verifica usuário
    const user = await getUserByDiscordId(targetId);
    if (!user || !user.active) {
      return loading.edit({
        embeds: [createErrorEmbed('Erro', 'Usuário não está na guilda.')]
      });
    }

    // Transação e balance
    await tggCoins.addTransaction(targetId, amount, type, description);
    const newBalance = await tggCoins.updateBalance(targetId, amount);

    return loading.edit({
      embeds: [
        createSuccessEmbed(
          'Moedas adicionadas!',
          `${target} recebeu **+${amount} TGG-Coins** 💰\n\n` +
          `📌 Tipo: **${type}**\n` +
          `📝 ${description}\n\n` +
          `💳 Novo saldo: **${newBalance.toLocaleString('pt-BR')}**`
        )
      ]
    });

  } catch (err) {
    return loading.edit({
      embeds: [createErrorEmbed('Erro ao adicionar coins', err.message)]
    });
  }
});

// ---- .addprovider (admin) ----
export const handleAddProvider = adminOnly(async (message, args, client) => {
  try {
    const discordId = message.author.id;
    const position = parseInt(args[0]);
    const member = message.mentions.members.first();

    if (isNaN(position) || position < 1 || !member) {
      return message.reply({
        embeds: [createErrorEmbed('Uso inválido', 'Use: `.addprovider <posição> @usuário`')]
      });
    }

    const state = shopState.get(discordId);

    if (!state) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Abra a loja primeiro usando `.shop`.')]
      });
    }

    if (Date.now() - state.createdAt > SHOP_STATE_TTL) {
      shopState.delete(discordId);

      return message.reply({
        embeds: [createErrorEmbed('Tempo expirado', 'Abra a loja novamente com `.shop`.')]
      });
    }

    const item = state.items[position - 1];

    if (!item) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Item não encontrado nessa página/categoria.')]
      });
    }

    if (item.type !== 'SERVICE') {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Esse item não é um serviço.')]
      });
    }

    const already = await tggCoins.isServiceProvider(item.id, member.id);

    if (already) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Esse usuário já é prestador desse serviço.')]
      });
    }

    await tggCoins.addServiceProvider(item.id, member.id);

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'Prestador adicionado!',
          `${member} agora pode realizar **${item.name}**`
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro', err.message)]
    });
  }
});

// ---- .removeprovider (admin) ----
export const handleRemoveProvider = adminOnly(async (message, args, client) => {
  try {
    const discordId = message.author.id;
    const position = parseInt(args[0]);
    const member = message.mentions.members.first();

    if (isNaN(position) || position < 1 || !member) {
      return message.reply({
        embeds: [createErrorEmbed('Uso inválido', 'Use: `.removeprovider <posição> @usuário`')]
      });
    }

    const state = shopState.get(discordId);

    if (!state) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Abra a loja primeiro usando `.shop`.')]
      });
    }

    if (Date.now() - state.createdAt > SHOP_STATE_TTL) {
      shopState.delete(discordId);

      return message.reply({
        embeds: [createErrorEmbed('Tempo expirado', 'Abra a loja novamente com `.shop`.')]
      });
    }

    const item = state.items[position - 1];

    if (!item) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Item não encontrado nessa página/categoria.')]
      });
    }

    if (item.type !== 'SERVICE') {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Esse item não é um serviço.')]
      });
    }

    const exists = await tggCoins.isServiceProvider(item.id, member.id);

    if (!exists) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Esse usuário não é prestador desse serviço.')]
      });
    }

    await tggCoins.removeServiceProvider(item.id, member.id);

    return message.reply({
      embeds: [
        createSuccessEmbed(
          'Prestador removido!',
          `${member} não pode mais realizar **${item.name}**`
        )
      ]
    });

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro', err.message)]
    });
  }
});

// Limpeza do estado da loja a cada 2 minutos (Remove estados expirados)
setInterval(() => {
  const now = Date.now();

  for (const [userId, state] of shopState.entries()) {
    if (now - state.createdAt > SHOP_STATE_TTL) {
      shopState.delete(userId);
    }
  }
}, 2 * 60 * 1000); // roda a cada 2 minutos