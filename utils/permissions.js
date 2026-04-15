import { getUserByDiscordId } from '../src/db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './discordUtils.js';
import { STAFF_ROLE_IDS } from '../config/index.js';

export const ROLE_HIERARCHY = {
  [STAFF_ROLE_IDS.helper]: 1,
  [STAFF_ROLE_IDS.moderator]: 2,
  [STAFF_ROLE_IDS.supervisor]: 3,
  [STAFF_ROLE_IDS.administrator]: 4,
  [STAFF_ROLE_IDS.viceLeader]: 5,
  [STAFF_ROLE_IDS.leader]: 6,
};

export const LEADER_ID = '252249131202904074'; // ID do líder para acesso total

// Canais permitidos para comandos do bot
const ALLOWED_CHANNELS = [
  '1437504463375175936', // Comandos Staff
  '1437416481343406122', // Principal
  '1437416406038872225', // Comandos
  '1468600851290521692'  // Players Inativos
];

const ALLOWED_CATEGORIES = [
  '1460768037518180352', // Categoria de Cards
  '1437504178220961815'  // Categoria da Staff
];

export async function isAdmin(userId) {
  try {
    const user = await getUserByDiscordId(userId);
    return user && user.active && user.role?.toLowerCase() === 'admin';
  } catch {
    return false;
  }
}

// Função para verificar se o usuário é líder da guilda (usado para comandos muito específicos)
export function isLeader(userId) {
  return userId === LEADER_ID;
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

export function leaderOnly(handler) {
  return async (message, ...args) => {
    if (!isLeader(message.author.id)) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Acesso Negado',
            'Apenas o líder pode usar esse comando.'
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

// Verifica se o comando foi usado em um canal permitido
export async function checkChannelPermission(message) {
  const channelId = message.channel.id;
  const categoryId = message.channel.parentId;

  // Permite se estiver na lista de canais ou dentro da categoria
  if (ALLOWED_CHANNELS.includes(channelId) || ALLOWED_CATEGORIES.includes(categoryId)) {
    return true;
  }

  try {
    await message.delete().catch(() => {});

    const msg = await message.channel.send({
      content: `${message.author}, use o canal <#1437416406038872225> para utilizar os comandos do bot.`
    });

    setTimeout(() => {
      msg.delete().catch(() => {});
    }, 5000);

  } catch (err) {
    console.error('Erro ao verificar canal:', err);
  }

  return false;
}