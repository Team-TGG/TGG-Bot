import { getUserByDiscordId } from '../src/db.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from './discordUtils.js';
import { STAFF_ROLE_IDS } from '../config/index.js';
import { MessageFlags } from 'discord.js';

export const ROLE_HIERARCHY = {
  [STAFF_ROLE_IDS.assistant]: 1,
  [STAFF_ROLE_IDS.helper]: 1,
  [STAFF_ROLE_IDS.moderator]: 2,
  [STAFF_ROLE_IDS.supervisor]: 3,
  [STAFF_ROLE_IDS.administrator]: 4,
  [STAFF_ROLE_IDS.viceLeader]: 5,
  [STAFF_ROLE_IDS.leader]: 6,
};

export const LEADER_ID = '252249131202904074'; // ID do líder para acesso total

// Canais permitidos para comandos do bot
export const ALLOWED_CHANNELS = [
  '1437504463375175936', // Comandos Staff
  '1440865671150829648', // TGG-Geral
  '1437416406038872225', // Comandos
  '1468600851290521692', // Players Inativos
  '1437416481343406122', // Principal (com cooldown de 60s)
];

export const ALLOWED_CATEGORIES = [
  '1460768037518180352', // Categoria de Cards
  '1437504178220961815'  // Categoria da Staff
];

// Canal Principal tem cooldown extra de 60s por usuário (staff isento, igual rate limit global)
export const PRINCIPAL_CHANNEL_ID = '1437416481343406122';
const PRINCIPAL_COOLDOWN_MS = 60_000;
const principalCooldownMap = new Map();

async function checkPrincipalCooldown(userId, isStaff) {
  if (isStaff) return true;
  const now = Date.now();
  const last = principalCooldownMap.get(userId);
  if (last && now - last < PRINCIPAL_COOLDOWN_MS) {
    return Math.ceil((PRINCIPAL_COOLDOWN_MS - (now - last)) / 1000);
  }
  principalCooldownMap.set(userId, now);
  return true;
}

// Versão slash: reusa constantes. Sem delete (não há msg original), ephemeral em vez de canal hint.
export async function checkInteractionChannelPermission(interaction) {
  if (await isAdmin(interaction.user.id)) return true;

  const channelId = interaction.channelId;
  const categoryId = interaction.channel?.parentId;

  if (!ALLOWED_CHANNELS.includes(channelId) && !ALLOWED_CATEGORIES.includes(categoryId)) {
    await interaction.reply({
      embeds: [createErrorEmbed('Canal Errado', `Use o canal <#1437416406038872225> para utilizar os comandos do bot.`)],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return false;
  }

  // Cooldown de 60s no canal Principal (staff isento)
  if (channelId === PRINCIPAL_CHANNEL_ID) {
    const isStaff = interaction.member?.roles?.cache?.some(r => Object.values(STAFF_ROLE_IDS).includes(r.id));
    const wait = await checkPrincipalCooldown(interaction.user.id, isStaff);
    if (wait !== true) {
      await interaction.reply({
        embeds: [createErrorEmbed('Calma lá!', `Comandos no <#${PRINCIPAL_CHANNEL_ID}> têm cooldown de **60s**. Aguarde **${wait}s**.`)],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return false;
    }
  }

  return true;
}

export async function isAdmin(userId) {
  try {
    const user = await getUserByDiscordId(userId);
    return (user && user.active && (user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'officer'));
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

/**
 * Prende um comando a um único canal, além da allowlist global.
 *
 * Vale nos dois caminhos de entrada: o shim do slash expõe `channelId`/`channel` igual à Message.
 * Admin/officer passa em qualquer canal, mesma regra de `checkChannelPermission` - staff precisa
 * usar comando fora do canal do público.
 */
export function channelOnly(channelId, handler) {
  return async (message, ...args) => {
    const canalAtual = message.channelId ?? message.channel?.id;

    if (canalAtual !== channelId && !(await isAdmin(message.author.id))) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Canal Errado',
            `Esse comando só funciona no canal <#${channelId}>.`
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
  const content = message.content?.trim();

  // ignora mensagens só com "."
  if (content === '.') return true;

  // admins e officers podem usar em qualquer canal
  if (await isAdmin(message.author.id)) {
    return true;
  }

  const channelId = message.channel.id;
  const categoryId = message.channel.parentId;

  // Fora de canais permitidos: apaga msg + hint
  if (!ALLOWED_CHANNELS.includes(channelId) && !ALLOWED_CATEGORIES.includes(categoryId)) {
    try {
      await message.delete().catch(() => {});
      const msg = await message.channel.send({
        content: `${message.author}, use o canal <#1437416406038872225> para utilizar os comandos do bot.`
      });
      setTimeout(() => { msg.delete().catch(() => {}); }, 5000);
    } catch (err) {
      console.error('Erro ao verificar canal:', err);
    }
    return false;
  }

  // Cooldown de 60s no canal Principal (staff isento)
  if (channelId === PRINCIPAL_CHANNEL_ID) {
    const isStaff = message.member?.roles?.cache?.some(r => Object.values(STAFF_ROLE_IDS).includes(r.id));
    const wait = await checkPrincipalCooldown(message.author.id, isStaff);
    if (wait !== true) {
      await message.delete().catch(() => {});
      await message.reply({
        embeds: [createErrorEmbed('Calma lá!', `Comandos no <#${PRINCIPAL_CHANNEL_ID}> têm cooldown de **60s**. Aguarde **${wait}s**.`)]
      }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
      return false;
    }
  }

  return true;
}
