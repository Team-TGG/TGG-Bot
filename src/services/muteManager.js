import { EmbedBuilder } from 'discord.js';
import { getActiveMutes, removePersistentMute, getPersistentMute } from '../db.js';
import { safeSetTimeout } from '../moderation.js';
import { discord as discordConfig, mutes as mutesConfig } from '../../config/index.js';

const MAX_DISCORD_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * Aplica timeout (limite 28 dias do Discord) e renova automaticamente.
 */
export async function scheduleMuteRenewal(guild, userId, expiresAtISO, notifyChannel = null) {
    // O timer só vale para o mute que o criou: sumiu a linha (.unmute) ou mudou o fim (.mute de novo
    // no mesmo membro), ele sai calado. Sem isso anunciava "desmutado" de quem já tinha sido
    // desmutado na mão, e o timer do primeiro mute apagava o segundo antes da hora.
    const atual = await getPersistentMute(userId);
    if (!atual || new Date(atual.expires_at).getTime() !== new Date(expiresAtISO).getTime()) return;

    const remainingMs = new Date(expiresAtISO) - Date.now();

    if (remainingMs <= 0) {
        await removePersistentMute(userId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            if (member.isCommunicationDisabled()) await member.timeout(null).catch(() => { });
            if (notifyChannel) {
                await notifyChannel.send({
                    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Desmutado')
                        .setDescription(`${member.user.tag} desmutado automaticamente.`)]
                }).catch(() => { });
            }
        }
        return;
    }

    const timeoutMs = Math.min(remainingMs, MAX_DISCORD_TIMEOUT_MS);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.timeout(timeoutMs).catch(() => { });

    safeSetTimeout(() => scheduleMuteRenewal(guild, userId, expiresAtISO, notifyChannel), timeoutMs);
}

export async function restoreMutes(client) {
    try {
        const activeMutes = await getActiveMutes();
        console.log(`[Boot] Restoring ${activeMutes.length} active mutes...`);

        const guild = client.guilds.cache.get(discordConfig.guildId);
        if (!guild) return;

        // Antes era "o primeiro canal de texto do cache", e o aviso caía em qualquer lugar, ticket incluído
        const notifyChannel = mutesConfig.logChannelId
            ? await guild.channels.fetch(mutesConfig.logChannelId).catch(() => null)
            : null;

        for (const mute of activeMutes) {
            scheduleMuteRenewal(guild, mute.user_id, mute.expires_at, notifyChannel);
        }
    } catch (err) {
        console.error('[Boot] Error restoring mutes:', err);
    }
}
