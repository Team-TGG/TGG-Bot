// Quem ganha o cargo de fila de espera: ghost ping no entrar-na-guilda e DM com o vídeo e o canal.
import { EmbedBuilder } from 'discord.js';
import { tickets as ticketsConfig, videoGuilda as videoGuildaConfig } from '../../config/index.js';

/**
 * Link do vídeo explicativo, lido da mensagem configurada em `videoGuilda.message`.
 * null quando a mensagem sumiu ou não tem vídeo. Mesma fonte do `.video-guilda`.
 */
export async function buscarVideoDaGuilda(client) {
  const { channelId, messageId } = videoGuildaConfig.message ?? {};
  if (!channelId || !messageId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  const videoMsg = channel?.isTextBased()
    ? await channel.messages.fetch(messageId).catch(() => null)
    : null;

  return videoMsg?.attachments.first()?.url || videoMsg?.content.trim() || null;
}

export async function avisarEntradaNaFila(oldMember, newMember) {
  const roleId = ticketsConfig.filaDeEsperaRoleId;
  if (oldMember.roles.cache.has(roleId) || !newMember.roles.cache.has(roleId)) return;

  const canalId = ticketsConfig.entrarNaGuildaChannelId;

  // Ghost ping: a menção some na hora, mas a notificação já foi entregue e leva a pessoa ao canal
  try {
    const canal = await newMember.client.channels.fetch(canalId);
    const ping = await canal.send({ content: `<@${newMember.id}>`, allowedMentions: { users: [newMember.id] } });
    await ping.delete();
  } catch (err) {
    console.warn(`[FILA] ghost ping falhou para ${newMember.id}:`, err.message);
  }

  const video = await buscarVideoDaGuilda(newMember.client);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🟢 Você está na fila de espera da TGG!')
    .setDescription(
      `Para garantir sua vaga, abra seu ticket em <#${canalId}>.\n\n` +
      (video ? 'Antes, assista ao vídeo explicativo da guilda logo abaixo. 🎬' : '')
    )
    .setTimestamp();

  // DM fechada é o caso comum e não é erro: o ghost ping já levou a pessoa ao canal
  await newMember.send({ embeds: [embed] })
    .then(() => video && newMember.send({ content: video }))
    .catch(() => console.log(`[FILA] DM fechada para ${newMember.id}`));
}
