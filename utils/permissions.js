import { getUserByDiscordId } from '../src/db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './discordUtils.js';
import { STAFF_ROLE_IDS } from '../config/index.js';

const ROLE_HIERARCHY = {
  [STAFF_ROLE_IDS.helper]: 1,
  [STAFF_ROLE_IDS.moderator]: 2,
  [STAFF_ROLE_IDS.supervisor]: 3,
  [STAFF_ROLE_IDS.administrator]: 4,
  [STAFF_ROLE_IDS.viceLeader]: 5,
  [STAFF_ROLE_IDS.leader]: 6,
};

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

export function getMemberLevel(member) {
  let level = 0;

  member.roles.cache.forEach(role => {
    if (ROLE_HIERARCHY[role.id]) {
      level = Math.max(level, ROLE_HIERARCHY[role.id]);
    }
  });

  return level;
}

export function hasPermission(member, requiredLevel) {
  return getMemberLevel(member) >= requiredLevel;
}