import { AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { createErrorEmbed, createPagination } from '../../utils/discordUtils.js';
import { tradutor } from '../i18n/index.js';
import { getRankedQueueService } from '../services/rankedQueueRuntime.js';
import { buildQueueEmbed, queuePages, QUEUE_IMAGE_NAME } from '../queueViews.js';
import { EMOJIS } from '../../config/emojis.js';

export function createQueueHandler({ getService = getRankedQueueService, paginate = createPagination } = {}) {
  return async function handleQueue(message, args = []) {
    const t = tradutor(message);
    if (!message.guild) return message.reply({ embeds: [createErrorEmbed(t('Queue indisponível'), t('Use este comando dentro do servidor.'))] });
    let mode = String(message.interaction?.options.getString('modo') || args[0] || '1v1').toLowerCase();
    if (!['1v1', '2v2'].includes(mode)) return message.reply({ embeds: [createErrorEmbed(t('Modalidade inválida'), t('Use /queue modo:1v1 ou /queue modo:2v2.'))] });
    let service, view;
    try { service = getService(); view = await service.snapshot(mode); }
    catch (error) {
      if (!error.queueCode) throw error;
      return message.reply({ embeds: [createErrorEmbed(t('Queue indisponível'), t('O monitor está indisponível. Tente novamente em alguns minutos.'))] });
    }
    return paginate(message, {
      getEmbed: page => buildQueueEmbed(view, page, t),
      getTotalPages: () => queuePages(view),
      files: [new AttachmentBuilder(fileURLToPath(new URL('../../assets/queue/ranked-mascot.png', import.meta.url)), { name: QUEUE_IMAGE_NAME, description: t('Imagem do monitor de ranqueada da TGG.') })],
      time: 15 * 60_000, idle: 6 * 60_000, disableOnEnd: true, prevId: 'queue_prev', nextId: 'queue_next',
      extraButtons: () => [
        new ButtonBuilder().setCustomId('queue_1v1').setLabel('1v1').setEmoji(EMOJIS.crossedSwords).setStyle(mode === '1v1' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('queue_2v2').setLabel('2v2').setEmoji(EMOJIS.team).setStyle(mode === '2v2' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('queue_refresh').setLabel(t('Atualizar lista')).setEmoji(EMOJIS.refresh).setStyle(ButtonStyle.Success),
      ],
      onExtra: async (interaction, page) => {
        const selected = interaction.customId === 'queue_1v1' ? '1v1' : interaction.customId === 'queue_2v2' ? '2v2' : mode;
        const changed = selected !== mode;
        const next = await service.snapshot(selected);
        mode = selected; view = next;
        return changed ? 1 : page;
      },
    });
  };
}

export const handleQueueCommand = createQueueHandler();
