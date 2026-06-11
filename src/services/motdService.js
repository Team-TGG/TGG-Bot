import { EmbedBuilder } from 'discord.js';
import { motd as motdConfig } from '../../config/index.js';
import { getRandomUnusedMotd, markMotdUsed } from '../db.js';

export async function publishMotd(client) {
  try {
    if (!motdConfig.channelId) {
      console.log('[MOTD] Channel not configured, skipping');
      return;
    }

    const channel = await client.channels.fetch(motdConfig.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      console.log(`[MOTD] Channel ${motdConfig.channelId} not found or is not text based`);
      return;
    }

    const currentMotd = await getRandomUnusedMotd();
    if (!currentMotd?.message) {
      console.log('[MOTD] No messages available');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('📢 Mensagem do Dia')
      .setDescription(currentMotd.message)
      .setFooter({ text: `Enviada por ${currentMotd.name || 'Membro TGG'}` })
      .setTimestamp();

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });

    await markMotdUsed(currentMotd.id);
    console.log(`[MOTD] Published MOTD ${currentMotd.id}`);
  } catch (err) {
    console.error('[MOTD] Error publishing MOTD:', err);
  }
}
