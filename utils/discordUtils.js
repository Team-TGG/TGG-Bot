import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Events, PermissionFlagsBits, ChannelType } from 'discord.js';

export function createErrorEmbed(title, description) {
  const safeDescription = String(description || 'Ocorreu um erro inesperado.');

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`❌ ${title}`)
    .setDescription(safeDescription.slice(0, 4096));
}

export function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`✅ ${title}`)
    .setDescription(description);
}

export function createLoadingEmbed(title, description) {
  const embed = new EmbedBuilder().setColor(0xfaa61a);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

export function createWarningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`⚠️ ${title}`)
    .setDescription(description);
}

export async function sendCleanMessage(msg, content) {
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

export async function createPagination(message, {
  getEmbed,
  getTotalPages,
  time = 60000,
  prevId = 'pg_prev',
  nextId = 'pg_next',
  extraButtons = null,
  onExtra = null,
}) {
  let page = 1;

  function buildRow(p, tp) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(prevId).setLabel('⬅️').setStyle(ButtonStyle.Primary).setDisabled(p <= 1),
      new ButtonBuilder().setCustomId(nextId).setLabel('➡️').setStyle(ButtonStyle.Primary).setDisabled(p >= tp),
      ...(extraButtons ? extraButtons() : []),
    );
  }

  const initialTp = await getTotalPages();
  const msg = await message.reply({
    embeds: [await getEmbed(page)],
    components: [buildRow(page, initialTp)],
  });

  const collector = msg.createMessageComponentCollector({ time });

  collector.on('collect', async (interaction) => {
    try {
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ content: 'Você não pode usar isso.', ephemeral: true });
      }

      await interaction.deferUpdate();

      if (interaction.customId === prevId) page = Math.max(1, page - 1);
      else if (interaction.customId === nextId) page++;
      else if (onExtra) {
        const newPage = await onExtra(interaction, page);
        if (newPage !== undefined) page = newPage;
      }

      const tp = await getTotalPages();
      page = Math.min(page, Math.max(1, tp));

      await interaction.editReply({
        embeds: [await getEmbed(page)],
        components: [buildRow(page, tp)],
      });
    } catch (err) {
      console.error('[PAGINATION ERROR]', err);
    }
  });

  return msg;
}

export async function awaitConfirmation(message, embed, {
  time = 30000,
  authorId,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmStyle = ButtonStyle.Success,
  cancelStyle = ButtonStyle.Danger,
} = {}) {
  const uid = Date.now();
  const confirmId = `confirm_${uid}`;
  const cancelId = `cancel_${uid}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(confirmStyle),
    new ButtonBuilder().setCustomId(cancelId).setLabel(cancelLabel).setStyle(cancelStyle),
  );

  const msg = await message.reply({ embeds: [embed], components: [row] });

  return new Promise((resolve) => {
    const collector = msg.createMessageComponentCollector({ time });

    collector.on('collect', async (interaction) => {
      if (interaction.user.id !== authorId) {
        return interaction.reply({ content: 'Você não pode usar isso.', ephemeral: true });
      }
      collector.stop('answered');
      resolve({ confirmed: interaction.customId === confirmId, interaction, msg });
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await msg.edit({
          embeds: [createErrorEmbed('Tempo Expirado', 'Nenhuma ação foi tomada.')],
          components: [],
        }).catch(() => {});
        resolve({ confirmed: null, msg });
      }
    });
  });
}
