import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, Events, PermissionFlagsBits, ChannelType } from 'discord.js';

export function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`❌ ${title}`)
    .setDescription(description);
}

export function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`✅ ${title}`)
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