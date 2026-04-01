import { EmbedBuilder} from 'discord.js';
import { getActiveMutes, removePersistentMute } from '../db.js';
import { safeSetTimeout } from '../moderation.js';
import { discord as discordConfig } from '../../config/index.js';

export async function restoreMutes(client) {
    try {
        const activeMutes = await getActiveMutes();
        console.log(`[Boot] Restoring ${activeMutes.length} active mutes...`);

        const guild = client.guilds.cache.get(discordConfig.guildId);
        if (!guild) return;

        let muteRole = guild.roles.cache.find(r => r.name === 'Muted');

        for (const mute of activeMutes) {
            const remainingMs = new Date(mute.expires_at) - new Date();
            if (remainingMs <= 0) {
            await removePersistentMute(mute.user_id);
            const member = await guild.members.fetch(mute.user_id).catch(() => null);
            if (member && muteRole) {
                await member.roles.remove(muteRole).catch(() => { });
            }
            continue;
            }

            safeSetTimeout(async () => {
            const m = await guild.members.fetch(mute.user_id).catch(() => null);
            if (m && muteRole && m.roles.cache.has(muteRole.id)) {
                await m.roles.remove(muteRole).catch(() => { });
                if (m.voice.serverMute) await m.voice.setMute(false, 'Auto-unmute').catch(() => { });
                await removePersistentMute(mute.user_id);
                const channel = guild.channels.cache.find(c => c.name === 'staff-logs' || c.isTextBased());
                if (channel) {
                await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Desmutado').setDescription(`${m.user.tag} desmutado automaticamente (restaurado do banco).`)] }).catch(() => { });
                }
            }
            }, remainingMs);
        }
    } catch (err) {
    console.error('[Boot] Error restoring mutes:', err);
    }
}