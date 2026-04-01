import { getUserByDiscordId } from '../src/db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './discordUtils.js';

export async function isAdmin(userId) {
  try {
    const user = await getUserByDiscordId(userId);
    return user && user.active && user.role?.toLowerCase() === 'admin';
  } catch {
    return false;
  }
}

export function adminOnly(handler) {
  return async (message, ...args) => {
    const allowed = await isAdmin(message.author.id);

    if (!allowed) {
      return message.reply({
            embeds: [
            createErrorEmbed(
                'Acesso Negado',
                'Apenas administradores podem usar esse comando.'
            )
            ]
        });
    }

    return handler(message, ...args);
  };
}