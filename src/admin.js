// admin.js - Comandos apenas para administradores
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, PermissionFlagsBits } from 'discord.js';
import { addWarning, getUserWarnings, removeWarning, removeLastWarning, parseTime, formatTime as formatModTime } from './moderation.js';
import { getInactivePlayers, addInactivePlayer, removeInactivePlayer, reactivateOrAddUser } from './db.js';
import { discord as discordConfig, ALLOWED_USER_IDS } from '../config/index.js';

// Funções auxiliares
function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`❌ ${title}`)
    .setDescription(description);
}

function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`✅ ${title}`)
    .setDescription(description);
}

async function isAdmin(userId) {
  return ALLOWED_USER_IDS.includes(userId);
}

// ---- .warn ----
export async function handleWarn(message, args, client) {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    if (!await isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')] });
    }

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.warn <@user/ID> [motivo]`')] });

    const reason = message.content.includes('>')
      ? message.content.split('>').slice(1).join('>').trim()
      : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    await addWarning(targetId, reason, message.author.id);
    const warnings = await getUserWarnings(targetId);

    const warnCount = warnings.length;
    let actionTaken = '';

    if (warnCount >= 3) {
      try {
        await member.ban({ reason: `Ban automático após 3 avisos. Último aviso: ${reason}` });
        actionTaken = '\n🚫 **Usuário foi banido automaticamente (3 avisos)**';
      } catch (e) {
        actionTaken = '\n⚠️ Não foi possível banir automaticamente.';
      }
    } else if (warnCount === 2) {
      try {
        const muteDuration = 3600; // 1 hour
        const muteUntil = new Date(Date.now() + muteDuration * 1000);
        await member.timeout(muteDuration * 1000, `Mute automático após 2 avisos`);
        actionTaken = `\n🔇 **Usuário foi mutado por ${formatModTime(muteDuration)} (2 avisos)**`;
      } catch (e) {
        actionTaken = '\n⚠️ Não foi possível mutar automaticamente.';
      }
    }

    await message.reply({
      embeds: [createSuccessEmbed('Aviso Registrado', `<@${targetId}> recebeu um aviso.\n**Motivo:** ${reason}\n**Total de avisos:** ${warnCount}${actionTaken}`)]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Registrar Aviso', err.message)] });
  }
}

// ---- .unwarn ----
export async function handleUnwarn(message, args, client) {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    if (!await isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')] });
    }

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unwarn <@user/ID> [número]`')] });

    const warnings = await getUserWarnings(targetId);
    if (!warnings.length) return message.reply({ embeds: [createErrorEmbed('Sem Avisos', 'Este usuário não possui avisos registrados.')] });

    const warnNumber = parseInt(args[1]);
    let removed;

    if (!isNaN(warnNumber) && warnNumber > 0 && warnNumber <= warnings.length) {
      removed = await removeWarning(targetId, warnings[warnNumber - 1].id);
    } else {
      removed = await removeLastWarning(targetId);
    }

    if (removed) {
      await message.reply({ embeds: [createSuccessEmbed('Aviso Removido', `Aviso removido de <@${targetId}>.\n**Avisos restantes:** ${warnings.length - 1}`)] });
    } else {
      await message.reply({ embeds: [createErrorEmbed('Erro', 'Não foi possível remover o aviso.')] });
    }
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Remover Aviso', err.message)] });
  }
}

// ---- .mute ----
export async function handleMute(message, args, client) {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    if (!await isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')] });
    }

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.mute <@user/ID> <duração>`')] });

    const durationStr = args.find(arg => /^\d+[smhdMy]$/.test(arg));
    if (!durationStr) return message.reply({ embeds: [createErrorEmbed('Duração Inválida', 'Formato: 1s, 1m, 1h, 1d, 1M, 1y')] });

    const duration = parseTime(durationStr);
    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    await member.timeout(duration * 1000, `Mute por ${formatModTime(duration)}`);

    await message.reply({
      embeds: [createSuccessEmbed('Mutado', `<@${targetId}> foi mutado por ${formatModTime(duration)}.`)]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Mutar', err.message)] });
  }
}

// ---- .unmute ----
export async function handleUnmute(message, args, client) {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    if (!await isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')] });
    }

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unmute <@user/ID>`')] });

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    await member.timeout(null);

    await message.reply({
      embeds: [createSuccessEmbed('Desmutado', `<@${targetId}> foi desmutado.`)]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Desmutar', err.message)] });
  }
}

// ---- .ban ---- (with button confirmation)
export async function handleBan(message, args, client) {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    if (!await isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')] });
    }

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.ban <@user/ID> [motivo]`')] });

    if (await isAdmin(targetId)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode banir um administrador.')] });
    }

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    const reason = message.content.includes('>')
      ? message.content.split('>').slice(1).join('>').trim()
      : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

    // Cria botões de confirmação
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_ban')
        .setLabel('✅ Confirmar Ban')
        .setStyle(4), // Danger style
      new ButtonBuilder()
        .setCustomId('cancel_ban')
        .setLabel('❌ Cancelar')
        .setStyle(2) // Secondary style
    );

    const confirmEmbed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle('⚠️ Confirmar Banimento')
      .setDescription(`Você está prestes a banir **${member.user.tag}**.\n\n**Motivo:** ${reason}\n\nClique em "Confirmar Ban" para prosseguir ou "Cancelar" para abortar.`)
      .setFooter({ text: 'Esta ação expira em 30 segundos' });

    const confirmMsg = await message.reply({
      embeds: [confirmEmbed],
      components: [confirmRow]
    });

    // Cria coletor para interação com botões
    const collector = confirmMsg.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      time: 30000,
      max: 1
    });

    collector.on('collect', async (interaction) => {
      if (interaction.customId === 'confirm_ban') {
        try {
          await member.ban({ reason });
          await interaction.update({
            embeds: [createSuccessEmbed('Banido', `${member.user.tag} foi banido.\n**Motivo:** ${reason}`)],
            components: []
          });
        } catch (err) {
          await interaction.update({
            embeds: [createErrorEmbed('Erro ao Banir', err.message)],
            components: []
          });
        }
      } else {
        await interaction.update({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('❌ Cancelado').setDescription('Banimento cancelado.')],
          components: []
        });
      }
    });

    collector.on('end', async (collected) => {
      if (collected.size === 0) {
        await confirmMsg.edit({
          embeds: [createErrorEmbed('Tempo Esgotado', 'Banimento cancelado por inatividade.')],
          components: []
        }).catch(() => {});
      }
    });

  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Banir', err.message)] });
  }
}

// ---- .inac-all ----
export async function handleInacAll(message, client) {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    if (!await isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')] });
    }

    const inactivePlayers = await getInactivePlayers();

    for (const player of inactivePlayers) {
      const member = await guild.members.fetch(player.discord_id).catch(() => null);
      if (member) {
        const inactiveRole = guild.roles.cache.find(r => r.name === 'Inativo');
        if (inactiveRole) {
          await member.roles.add(inactiveRole).catch(() => {});
        }
      }
    }

    await message.reply({
      embeds: [createSuccessEmbed('Inativos Processados', `${inactivePlayers.length} jogadores receberam o cargo de inativo.`)]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro', err.message)] });
  }
}

// ---- .inac-list ----
export async function handleInacList(message, client) {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    if (!await isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')] });
    }

    const inactivePlayers = await getInactivePlayers();

    if (!inactivePlayers.length) {
      return message.reply({ embeds: [createErrorEmbed('Sem Inativos', 'Não há jogadores inativos registrados.')] });
    }

    const list = inactivePlayers.map((p, i) => `${i + 1}. <@${p.discord_id}> - Último login: ${p.last_seen || 'N/A'}`).join('\n');

    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📋 Lista de Inativos')
        .setDescription(list)
        .setFooter({ text: `Total: ${inactivePlayers.length} jogadores` })]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro', err.message)] });
  }
}
