import { EmbedBuilder } from 'discord.js';
import { getInactivePlayers } from '../db.js';
import { inactivePlayers as inactivePlayersConfig } from '../../config/index.js';

export async function sendInactivePlayersReminder(client) {
    try {
      const channelId = inactivePlayersConfig.channelId;
      if (!channelId) {
        console.log('[Inactive Reminder] INACTIVE_PLAYERS_CHANNEL_ID not configured, skipping');
        return;
      }

      const channel = client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`[Inactive Reminder] Channel ${channelId} not found`);
        return;
      }

      const inactivePlayers = await getInactivePlayers();

      if (inactivePlayers.length === 0) {
        console.log('[Inactive Reminder] No inactive players');
        return;
      }

      const mentions = inactivePlayers
        .filter(p => p.discord_id)
        .map(p => `<@${p.discord_id}>`)
        .join(' ');

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle('⚠️ Lembrete: Usuários Inativos')
        .setDescription(`Olá! Vocês estão marcados como inativos
          Se você está nesta lista, significa que fez menos de 1000 de contribuição na semana passada. 

          Para saber como contribuir, veja o canal <#${'1480627066792579072'}> ou fale com um membro da staff.

          Para mostrar que está ativo, use o comando \`.active\` com uma justificativa para se remover da lista.
          
          Ex: \`.active Estava viajando e não consegui jogar.\``)
        .setTimestamp();

      await channel.send({
        content: mentions, // Mencionar os players fora do embed pra pingar
        embeds: [embed],
        allowedMentions: {
          users: inactivePlayers
            .filter(p => p.discord_id)
            .map(p => p.discord_id),
        }
      });

      // DM
      const dmEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('⚠️ Aviso de Inatividade')
        .setDescription(`Você está inativo. Para mostrar que está ativo, use o comando \`.active <justificativa>\` no canal <#1468600851290521692>.`)
        .setTimestamp();

      for (const player of inactivePlayers) {
        if (!player.discord_id) continue;
        try {
          const user = await client.users.fetch(player.discord_id).catch(() => null);
          if (user) {
            await user.send({ embeds: [dmEmbed] }).catch(() => {
              console.log(`[Inactive Reminder] Could not send DM to ${player.discord_id}`);
            });
          }
        } catch (err) {
          console.log(`[Inactive Reminder] Failed to DM ${player.discord_id}: ${err.message}`);
        }
      }

      console.log(`[Inactive Reminder] Sent message and DMs with ${inactivePlayers.length} inactive players`);
    } catch (err) {
      console.error('[Inactive Reminder Error]', err);
    }
}

export function startInactiveReminder(client) {
    const interval = 10800000; // 3h

    setInterval(() => {
        sendInactivePlayersReminder(client);
    }, interval);

    setTimeout(() => {
        sendInactivePlayersReminder(client);
    }, 5000);
}