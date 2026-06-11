import { EmbedBuilder } from 'discord.js';
import { getActiveTemporaryWarnings, removeWarningById, safeSetTimeout } from '../moderation.js';

export function scheduleTemporaryWarningRemoval({ warning, guild, channel = null }) {
  if (!warning?.id || !warning?.user_id || !warning?.expires_at) return;

  const remainingMs = new Date(warning.expires_at).getTime() - Date.now();
  const delay = Math.max(0, remainingMs);

  safeSetTimeout(async () => {
    try {
      await removeWarningById(warning.id, warning.user_id);

      const member = await guild.members.fetch(warning.user_id).catch(() => null);
      if (member) {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('✅ Aviso Expirado')
              .setDescription(`Seu aviso em **${guild.name}** expirou e foi removido.\n**Motivo:** ${warning.reason || 'Sem motivo especificado'}`)
          ]
        }).catch(() => {});
      }

      if (channel) {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('✅ Aviso Expirado')
              .setDescription(`${member ? member.user.tag : `<@${warning.user_id}>`} teve um aviso temporário removido automaticamente.`)
          ]
        }).catch(() => {});
      }
    } catch (err) {
      console.error('[Warnings] Error expiring temporary warning:', err);
    }
  }, delay);
}

export async function restoreTemporaryWarnings(client) {
  try {
    const warnings = await getActiveTemporaryWarnings();
    if (!warnings.length) return;

    const guild = client.guilds.cache.first();
    if (!guild) return;

    console.log(`[Boot] Restoring ${warnings.length} temporary warning(s)...`);

    for (const warning of warnings) {
      scheduleTemporaryWarningRemoval({ warning, guild });
    }
  } catch (err) {
    console.error('[Boot] Error restoring temporary warnings:', err);
  }
}
