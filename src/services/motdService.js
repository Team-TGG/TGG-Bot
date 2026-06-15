import { EmbedBuilder } from 'discord.js';
import { motd as motdConfig } from '../../config/index.js';

async function fetchCurrentMotd() {
  if (!motdConfig.url) {
    console.log('[MOTD] API URL not configured, skipping');
    return null;
  }

  const response = await fetch(motdConfig.url);
  if (!response.ok) {
    throw new Error(`MOTD API returned ${response.status}`);
  }

  return response.json();
}

async function resolveAuthorName(client, author) {
  if (!author) return 'System';
  if (!/^\d+$/.test(String(author))) return author;

  const user = await client.users.fetch(author).catch(() => null);
  return user?.tag || author;
}

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

    const currentMotd = await fetchCurrentMotd();
    if (!currentMotd?.message) {
      console.log('[MOTD] No messages available');
      return;
    }

    const authorName = await resolveAuthorName(client, currentMotd.author);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('📢 Mensagem do Dia')
      .setDescription(currentMotd.message)
      .setFooter({ text: `Enviada por ${authorName}` })
      .setTimestamp();

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });

    console.log('[MOTD] Published current site MOTD');
  } catch (err) {
    console.error('[MOTD] Error publishing MOTD:', err);
  }
}
