// admin.js - Comandos apenas para administradores
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Events, PermissionFlagsBits, ChannelType, ComponentType } from 'discord.js';
import { createClient, runSync, runEloSync } from './discord.js';
import { fetchPlayerStats, getUserBrawlhallaId } from './brawlhalla.js';
import { addWarning, getUserWarnings, removeWarning, removeLastWarning, editWarning, deleteExpiredWarnings, parseTime, formatTime as formatModTime, safeSetTimeout } from './moderation.js';
import { getUsers, getAllUsers, getUsersWithElo, getAllUsersWithElo, getUserByDiscordId, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, getClient, reactivateOrAddUser, addPersistentMute, removePersistentMute, getActiveMutes, getMissionWeekStart, getActiveUser, getMemberJustifications, formatDateBR } from './db.js';
import { discord as discordConfig, STAFF_ROLE_IDS, inactivePlayers as inactivePlayersConfig, tickets as ticketsConfig } from '../config/index.js';
import { loadCustomNicknames } from './customNicknames.js';
import { syncNicknames, updateMemberNicknameDiscordPortion, parseNickname, buildNickname, fetchBrawlhallaClanData, loadClanCache } from './nicknameSync.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed, createLoadingEmbed, sendCleanMessage, awaitConfirmation } from '../utils/discordUtils.js';
import { isAdmin, adminOnly, hasPermission, getMemberLevel} from '../utils/permissions.js';
import { EMOJIS } from '../config/emojis.js';
import { scheduleTemporaryWarningRemoval } from './services/warningManager.js';

// Funções auxiliares

// Configura permissões do cargo Muted em todos os canais (incluindo fóruns) — em paralelo
async function setupMutePermissions(guild, muteRole) {
  const denyPermissions = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.Speak,
  ];

  const targetChannelTypes = [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildForum,
    ChannelType.GuildStageVoice,
    ChannelType.GuildCategory,
    ChannelType.GuildMedia,
  ];

  const channels = guild.channels.cache.filter(c => targetChannelTypes.includes(c.type));

  // Filtra apenas canais que precisam de atualização
  const channelsToUpdate = [];
  for (const [, channel] of channels) {
    const existingOverwrite = channel.permissionOverwrites.cache.get(muteRole.id);
    if (existingOverwrite) {
      const denied = existingOverwrite.deny;
      const allDenied = denyPermissions.every(p => denied.has(p));
      if (allDenied) continue; // Já está configurado corretamente
    }
    channelsToUpdate.push(channel);
  }

  if (channelsToUpdate.length === 0) return;

  // Atualiza todos os canais em paralelo
  const muteOverrides = {
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false,
    Speak: false,
  };

  const results = await Promise.allSettled(
    channelsToUpdate.map(channel =>
      channel.permissionOverwrites.edit(muteRole, muteOverrides)
    )
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    console.error(`[Mute] ${failed.length}/${channelsToUpdate.length} canais falharam ao configurar permissões.`);
  }
}

// .sync
export const handleSync = adminOnly(async (message, args, client) => {
  const loading = await message.reply({ embeds: [createLoadingEmbed(`${EMOJIS.loading} Sincronizando...`, 'Executando sincronização completa...')] });
  try {
    const users = await getUsers();
    const guildResult = await runSync(client, users);
    const usersWithElo = await getUsersWithElo();
    const eloResult = await runEloSync(client, usersWithElo);
    const resultEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`${EMOJIS.check} Sincronização Completa`)
      .addFields(
        { name: 'Ranks', value: `${EMOJIS.check} ${guildResult.synced} | ${EMOJIS.checkbox} ${guildResult.skipped} | ${EMOJIS.xis} ${guildResult.errors}`, inline: true },
        { name: 'ELO', value: `${EMOJIS.check} ${eloResult.synced} | ${EMOJIS.checkbox} ${eloResult.skipped} | ${EMOJIS.xis} ${eloResult.errors}`, inline: true }
      )
      .setTimestamp();
    await loading.edit({ embeds: [resultEmbed] });
  } catch (err) {
    await loading.edit({ embeds: [createErrorEmbed('Erro de Sincronização', err.message)] });
  }
});

// .sync-all
export const handleSyncAll = adminOnly(async (message, args, client) => {
  const loading = await message.reply({ embeds: [createLoadingEmbed(`${EMOJIS.loading} Sincronizando (FULL)...`, 'Executando sincronização completa (todos os usuários)...')] });

  try {
    const users = await getAllUsers();
    const guildResult = await runSync(client, users);

    const usersWithElo = await getAllUsersWithElo();
    const eloResult = await runEloSync(client, usersWithElo);

    const resultEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`${EMOJIS.check} Sincronização Completa (FULL)`)
      .addFields(
        {
          name: 'Ranks',
          value: `${EMOJIS.check} ${guildResult.synced} | ${EMOJIS.checkbox} ${guildResult.skipped} | ${EMOJIS.xis} ${guildResult.errors}`,
          inline: true
        },
        {
          name: 'ELO',
          value: `${EMOJIS.check} ${eloResult.synced} | ${EMOJIS.checkbox} ${eloResult.skipped} | ${EMOJIS.xis} ${eloResult.errors}`,
          inline: true
        }
      )
      .setTimestamp();

    await loading.edit({ embeds: [resultEmbed] });

  } catch (err) {
    await loading.edit({
      embeds: [createErrorEmbed('Erro de Sincronização', err.message)]
    });
  }
});

// .sync-nick
export const handleSyncNick = adminOnly(async (message, args, client) => {
  const loading = await message.reply({ embeds: [createLoadingEmbed(`${EMOJIS.loading} Sincronizando...`, 'Sincronizando apelidos com clan Brawlhalla...')] });
  try {
    await loadCustomNicknames();
    const result = await syncNicknames(client, discordConfig.guildId);
    const resultEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`${EMOJIS.check} Apelidos Sincronizados`)
      .addFields(
        { name: `${EMOJIS.check} Sincronizados`, value: `${result.synced}`, inline: true },
        { name: `${EMOJIS.cima} Atualizados`, value: `${result.updated}`, inline: true },
        { name: `${EMOJIS.square} Inalterados`, value: `${result.unchanged}`, inline: true },
        { name: `${EMOJIS.xis} Erros`, value: `${result.failed}`, inline: true }
      )
      .setTimestamp();
    if (result.errors && result.errors.length > 0 && result.errors.length <= 5) {
      const errorList = result.errors.map((e) => `• ${e.error}`).join('\n');
      resultEmbed.addFields({ name: 'Próximos erros', value: errorList, inline: false });
    }
    await loading.edit({ embeds: [resultEmbed] });
  } catch (err) {
    await loading.edit({ embeds: [createErrorEmbed('Erro de Sincronização', err.message)] });
  }
});

// .refresh-cache
export const handleRefreshCache = adminOnly(async (message, args, client) => {
  const loading = await message.reply({ embeds: [createLoadingEmbed(`${EMOJIS.loading} Atualizando...`, 'Atualizando cache do clan Brawlhalla...')] });
  try {
    const clanData = await fetchBrawlhallaClanData();
    await sendCleanMessage(loading, { embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`${EMOJIS.check} Cache Atualizado`).setDescription(`${clanData.clan?.length || 0} membros`).addFields({ name: 'Clan', value: `${clanData.clan_name} (${clanData.clan_id})`, inline: true }).setTimestamp()] });
  } catch (err) {
    await sendCleanMessage(loading, { embeds: [createErrorEmbed('Erro ao Atualizar Cache', err.message)] }).catch(() => { });
  }
});

// .warn
export const handleWarn = adminOnly(async (message, args, client) => {
  try {

    // Apenas moderadores ou superiores podem usar esse comando
    if (!hasPermission(message.member, 2)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas moderadores ou superiores podem dar avisos.')]
      });
    }

    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) {
      return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.warn <@user/ID> [duração] [motivo]`')] });
    }

    if (await isAdmin(targetId)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode dar um aviso a um administrador.')] });
    }

    const afterTarget = mentionMatch
      ? message.content.slice(message.content.indexOf(mentionMatch[0]) + mentionMatch[0].length).trim()
      : args.slice(1).join(' ').trim();
    const durationMatch = afterTarget.match(/^(\d+[smhdMy])(?:\s+|$)/);
    const durationMs = durationMatch ? parseTime(durationMatch[1]) : null;
    const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    const reason = durationMatch
      ? afterTarget.slice(durationMatch[0].length).trim() || 'Sem motivo especificado'
      : afterTarget || 'Sem motivo especificado';

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    const { warningCount, warning } = await addWarning(targetId, message.author.id, reason, expiresAt);
    const durationLine = expiresAt ? `\n**Duração:** ${formatModTime(durationMs)}` : '';
    const expiresLine = expiresAt ? `\n**Expira em:** <t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:F>` : '';

    await member.send({
      embeds: [
        createWarningEmbed(
          'Aviso Recebido',
          `Você recebeu um warn/aviso.\n**Motivo:** ${reason}${durationLine}${expiresLine}\n**Total de avisos:** ${warningCount}/3`
        )
      ]
    }).catch(() => console.log(`[Warn] Could not send DM to ${targetId}`));

    if (expiresAt) {
      scheduleTemporaryWarningRemoval({
        warning,
        guild,
        channel: message.channel
      });
    }

    await message.reply({ embeds: [createSuccessEmbed('Aviso Adicionado', `${member.user.tag} recebeu um aviso.\n**Motivo:** ${reason}${durationLine}${expiresLine}\n**Total de avisos:** ${warningCount}/3`)] });

    if (warningCount === 2) {
      let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
      if (!muteRole) muteRole = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'Cargo para silenciados' });
      await member.roles.add(muteRole);
      setTimeout(() => member.roles.remove(muteRole).catch(() => { }), 15 * 60 * 1000);
      await message.channel.send({ embeds: [createWarningEmbed('Mute Automático', `${member.user.tag} foi silenciado por 15 minutos (2 avisos).`)] });
      // Atualiza permissões em background (não bloqueia resposta)
      setupMutePermissions(guild, muteRole).catch(err => console.error('[Mute] Erro ao configurar permissões:', err));
    } else if (warningCount >= 3) {
      await member.ban({ reason: '3 avisos acumulados' });
      await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('🔨 Ban Automático').setDescription(`${member.user.tag} foi banido por 3 avisos acumulados.`)] });
    }
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Adicionar Aviso', err.message)] });
  }
});

// .wam (warn falso, só para brincadeira)
export const handleWam = adminOnly(async (message, args, client) => {
  try {

    // Apenas helpers ou superiores podem usar esse comando
    if (!hasPermission(message.member, 1)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas helpers ou superiores podem dar avisos.')]
      });
    }

    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);

    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) {
      return message.reply({
        embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.wam <@user/ID> [motivo]`')]
      });
    }

    const reason = message.content.includes('>')
      ? message.content.split('>').slice(1).join('>').trim()
      : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

    const member = await guild.members.fetch(targetId).catch(() => null);

    if (!member) {
      return message.reply({
        embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
      });
    }

    // Número fake de avisos
    const fakeWarnings = Math.floor(Math.random() * 3) + 1;

    await message.reply({
      embeds: [
        createSuccessEmbed(
          'Aviso Adicionado',
          `${member.user.tag} recebeu um aviso.\n**Motivo:** ${reason}\n**Total de avisos:** ${fakeWarnings}/3`
        )
      ]
    });

  } catch (err) {
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Adicionar Aviso', err.message)]
    });
  }
});

// .unwarn
export const handleUnwarn = adminOnly(async (message, args, client) => {
  try {

    // Apenas moderadores ou superiores podem usar esse comando
    if (!hasPermission(message.member, 2)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas moderadores ou superiores podem dar avisos.')]
      });
    }

    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unwarn <@user/ID>`')] });

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    const removedWarnNumber = await removeLastWarning(targetId);
    if (!removedWarnNumber) {
      return message.reply({ embeds: [createErrorEmbed('Sem Avisos', 'Este usuário não possui avisos para remover.')] });
    }

    await message.reply({ embeds: [createSuccessEmbed('Aviso Removido', `O último aviso (Aviso **${removedWarnNumber}**) de ${member.user.tag} foi removido.`)] });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Remover Aviso', err.message)] });
  }

});

// .edit-warn
export const handleEditWarn = adminOnly(async (message, args, client) => {
  try {
    if (!hasPermission(message.member, 2)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas moderadores ou superiores podem editar avisos.')]
      });
    }

    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    // Extrai menção ou ID
    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) {
      return message.reply({
        embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.edit-warn <@user/ID> <número> "Motivo"`')]
      });
    }

    // Extrai o número do aviso e o novo motivo
    // Sintaxe: .edit-warn @user <número> "Motivo"
    const afterMention = mentionMatch
      ? message.content.slice(message.content.indexOf(mentionMatch[0]) + mentionMatch[0].length).trim()
      : args.slice(1).join(' ').trim();

    const warnNumMatch = afterMention.match(/^(\d+)\s+/);
    if (!warnNumMatch) {
      return message.reply({
        embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.edit-warn <@user/ID> <número> "Motivo"`')]
      });
    }

    const warningNumber = parseInt(warnNumMatch[1]);
    const newReason = afterMention.slice(warnNumMatch[0].length).replace(/^["']|["']$/g, '').trim();

    if (!newReason) {
      return message.reply({
        embeds: [createErrorEmbed('Formato Inválido', 'Informe o novo motivo após o número do aviso.')]
      });
    }

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      return message.reply({
        embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
      });
    }

    const updated = await editWarning(targetId, warningNumber, newReason);
    if (!updated) {
      return message.reply({
        embeds: [createErrorEmbed('Aviso Não Encontrado', `O aviso **${warningNumber}** de ${member.user.tag} não existe.`)]
      });
    }

    await message.reply({
      embeds: [createSuccessEmbed('Aviso Editado', `O aviso **${warningNumber}** de ${member.user.tag} foi atualizado.\n**Novo motivo:** ${newReason}`)]
    });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Editar Aviso', err.message)] });
  }
});

// .warns
export const handleWarns = async (message, args, client) => {
  try {
    await deleteExpiredWarnings();

    const admin = await isAdmin(message.author.id);

    let targetUser = message.author;

    // Admin pode consultar outro usuário por menção ou ID
    if (args[0]) {

      const possibleUser = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);

      if (possibleUser) {

        if (!admin && possibleUser.id !== message.author.id) {
          return message.reply({
            embeds: [
              createErrorEmbed(
                'Sem Permissão',
                'Você só pode visualizar seus próprios avisos.'
              )
            ]
          });
        }

        targetUser = possibleUser;
      }
    }

    const viewingOthers = targetUser.id !== message.author.id;

    const dbClient = getClient();

    let query = dbClient
      .from('warnings')
      .select('*')
      .order('created_at', { ascending: false });

    // Usuário comum vê apenas os próprios warns
    if (!admin || viewingOthers) {
      query = query.eq('user_id', targetUser.id);
    }

    const { data: allWarnings, error } = await query;

    if (error) {
      throw error;
    }

    if (!allWarnings || allWarnings.length === 0) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Sem Avisos',
            viewingOthers
              ? 'Este usuário não possui avisos.'
              : 'Você não possui avisos.'
          )
        ]
      });
    }

    // Agrupar por usuário
    const byUser = {};

    for (const w of allWarnings) {

      const guildMember = await message.guild.members
        .fetch(w.user_id)
        .catch(() => null);

      // Ignora usuários fora do servidor
      if (!guildMember) {
        continue;
      }

      // Ignora banidos
      if (guildMember.bannable === false && !guildMember.manageable) {
        continue;
      }

      if (!byUser[w.user_id]) {
        byUser[w.user_id] = {
          user_id: w.user_id,
          member: guildMember,
          warnings: [],
          latest: w.created_at
        };
      }

      byUser[w.user_id].warnings.push(w);

      if (
        new Date(w.created_at) >
        new Date(byUser[w.user_id].latest)
      ) {
        byUser[w.user_id].latest = w.created_at;
      }
    }

    const sorted = Object.values(byUser).sort(
      (a, b) => new Date(b.latest) - new Date(a.latest)
    );

    if (sorted.length === 0) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Sem Avisos',
            'Nenhum aviso válido encontrado.'
          )
        ]
      });
    }

    const pageSize = 5;
    let currentPage = 1;

    const generateEmbed = (page) => {

      const totalPages = Math.ceil(sorted.length / pageSize);

      const pageData = sorted.slice(
        (page - 1) * pageSize,
        page * pageSize
      );

      const description = pageData.map(ud => {

        const warns = ud.warnings.map((w, i) => {
          const expiration = w.expires_at
            ? `\n> Expira em: <t:${Math.floor(new Date(w.expires_at).getTime() / 1000)}:R>`
            : '';

          return [
            `> **${i + 1}.** ${w.reason || 'Sem motivo especificado'}`,
            `> ${new Date(w.created_at).toLocaleDateString('pt-BR')}${expiration}`
          ].join('\n');
        }).join('\n> \n');

        return [
          `<@${ud.user_id}> (${ud.member.displayName}) - ${ud.warnings.length} aviso(s)`,
          warns
        ].join('\n');

      }).join('\n\n');

      return new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(
          viewingOthers || !isAdmin
            ? `⚠️ Avisos de ${targetUser.displayName || targetUser.username}`
            : '⚠️ Sistema de Avisos'
        )
        .setDescription(
          `${isAdmin && !viewingOthers
            ? `👥 ${sorted.length} usuário(s) com avisos`
            : `${allWarnings.length} aviso(s) encontrado(s)`}\n\n${description}`
        )
        .setFooter({
          text: `Página ${page}/${totalPages}`
        })
        .setTimestamp();
    };

    const generateButtons = (page) => {

      const totalPages = Math.ceil(sorted.length / pageSize);

      const row = new ActionRowBuilder();

      if (page > 1) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId('warns_prev')
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Secondary)
        );
      }

      row.addComponents(
        new ButtonBuilder()
          .setCustomId('warns_page')
          .setLabel(`${page}/${totalPages}`)
          .setDisabled(true)
          .setStyle(ButtonStyle.Secondary)
      );

      if (page < totalPages) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId('warns_next')
            .setEmoji('➡️')
            .setStyle(ButtonStyle.Secondary)
        );
      }

      return totalPages > 1 ? [row] : [];
    };

    const reply = await message.reply({
      embeds: [generateEmbed(currentPage)],
      components: generateButtons(currentPage)
    });

    const collector = reply.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      time: 60000
    });

    collector.on('collect', async interaction => {

      if (interaction.customId === 'warns_prev') {
        currentPage--;
      }

      if (interaction.customId === 'warns_next') {
        currentPage++;
      }

      await interaction.update({
        embeds: [generateEmbed(currentPage)],
        components: generateButtons(currentPage)
      });
    });

    collector.on('end', async () => {
      await reply.edit({
        components: []
      }).catch(() => {});
    });

  } catch (err) {

    console.error(err);

    await message.reply({
      embeds: [
        createErrorEmbed(
          'Erro ao Listar Avisos',
          err.message
        )
      ]
    });
  }
};

// .mute
export const handleMute = adminOnly(async (message, args, client) => {
  try {

    // Apenas moderadores ou superiores podem usar esse comando
    if (!hasPermission(message.member, 2)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas moderadores ou superiores podem mutar usuários.')]
      });
    }

    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.mute <@user/ID> <duração> [motivo]` — ex: `.mute @user 1h sendo tóxico`')] });

    if (await isAdmin(targetId)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode silenciar um administrador.')] });
    }

    const durationMatch = message.content.match(/\b(\d+[smhdMy])\b/);
    if (!durationMatch) return message.reply({ embeds: [createErrorEmbed('Duração Inválida', 'Formatos: 1s, 1m, 1h, 1d, 1M, 1y')] });
    const durationMs = parseTime(durationMatch[1]);
    if (!durationMs) return message.reply({ embeds: [createErrorEmbed('Duração Inválida', 'Formato não reconhecido.')] });

    // Extrai motivo (tudo depois da duração)
    const durationIndex = message.content.indexOf(durationMatch[1]);
    const reason = message.content.slice(durationIndex + durationMatch[1].length).trim() || 'Sem motivo especificado';

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
    if (!muteRole) muteRole = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'Cargo para silenciados' });
    await member.roles.add(muteRole);
    if (member.voice.channel) await member.voice.setMute(true, 'Moderação').catch(() => { });

    const expiresAt = new Date(Date.now() + durationMs).toISOString();
    await addPersistentMute(targetId, expiresAt);

    await message.reply({ embeds: [createSuccessEmbed('Silenciado', `${member.user.tag} silenciado por ${formatModTime(durationMs)}.\n**Motivo:** ${reason}`)] });

    // Atualiza permissões em background (não bloqueia resposta)
    setupMutePermissions(guild, muteRole).catch(err => console.error('[Mute] Erro ao configurar permissões:', err));

    safeSetTimeout(async () => {
      const m = await guild.members.fetch(targetId).catch(() => null);
      if (m?.roles.cache.has(muteRole.id)) {
        await m.roles.remove(muteRole).catch(() => { });
        if (m.voice.serverMute) await m.voice.setMute(false, 'Auto-unmute').catch(() => { });
        await removePersistentMute(targetId);
        await message.channel.send({ embeds: [createSuccessEmbed('Desmutado', `${m.user.tag} desmutado automaticamente.`)] }).catch(() => { });
      }
    }, durationMs);
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Silenciar', err.message)] });
  }
});

// .unmute
export const handleUnmute = adminOnly(async (message, args, client) => {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

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
    const muteRole = guild.roles.cache.find(r => r.name === 'Muted');
    if (!muteRole || !member.roles.cache.has(muteRole.id)) return message.reply({ embeds: [createErrorEmbed('Não Silenciado', 'Este usuário não está silenciado.')] });
    await member.roles.remove(muteRole);
    if (member.voice.serverMute) await member.voice.setMute(false, 'Moderação').catch(() => { });
    await removePersistentMute(targetId);
    await message.reply({ embeds: [createSuccessEmbed('Desmutado', `${member.user.tag} desmutado com sucesso.`)] });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Desmutar', err.message)] });
  }
});

// .ban
export const handleBan = adminOnly(async (message, args, client) => {
  try {

    // Apenas supervisores ou superiores podem usar esse comando
    if (!hasPermission(message.member, 3)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas supervisores ou superiores podem banir.')]
      });
    }

    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    let targetId;
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else {
      const idMatch = args[0]?.match(/^\d+$/);
      if (idMatch) targetId = args[0];
    }

    if (!targetId) {
      return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.ban <@user/ID> [motivo]`')] });
    }

    if (await isAdmin(targetId)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode banir um administrador.')] });
    }

    const reason = message.content.includes('>')
      ? message.content.split('>').slice(1).join('>').trim()
      : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });
    }

    const confirmEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('⚠️ Confirmação de Banimento')
      .setDescription('Você está prestes a banir o usuário abaixo:')
      .addFields(
        { name: 'Usuário', value: `${member.user.tag} (${member.id})` },
        { name: 'Motivo', value: reason }
      )
      .setFooter({ text: `Ação solicitada por ${message.author.tag}` });

    const { confirmed, interaction } = await awaitConfirmation(message, confirmEmbed, {
      authorId: message.author.id,
      time: 15000,
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
      confirmStyle: ButtonStyle.Danger,
      cancelStyle: ButtonStyle.Secondary,
    });

    if (confirmed === null) return;

    if (!confirmed) {
      return interaction.update({
        embeds: [createErrorEmbed('Ação Cancelada', 'O banimento foi cancelado.')],
        components: []
      });
    }

    await member.ban({ reason });

    await interaction.update({
      embeds: [createSuccessEmbed('Usuário Banido', `${member.user.tag} foi banido.\n**Motivo:** ${reason}`)],
      components: []
    });

  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Banir', err.message)] });
  }
});

// .inac-all
import pLimit from 'p-limit'; // Controle de concorrência para evitar rate limits do Discord
export const handleInacAll = adminOnly(async (message, args, client) => {
  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;

    const inactivePlayers = await getInactivePlayers();

    if (inactivePlayers.length === 0) {
      return message.reply({
        embeds: [createErrorEmbed('Sem Inativos', 'Nenhum jogador com note NULL encontrado.')]
      });
    }

    let applied = 0;
    let failed = 0;

    // Preenche o cache de membros (evita vários fetch individuais)
    await guild.members.fetch();

    // Controle de concorrência (evita rate limit do Discord)
    const limit = pLimit(5);

    const tasks = inactivePlayers.map((player) =>
      limit(async () => {
        try {
          // Usa cache primeiro, fallback pro fetch
          const member =
            guild.members.cache.get(player.discord_id) ||
            await guild.members.fetch(player.discord_id).catch(() => null);

          if (!member) {
            failed++;
            return;
          }

          if (!member.roles.cache.has(inactiveRoleId)) {
            await member.roles.add(inactiveRoleId);
          }

          // Notificação por DM
          await member.send({
            embeds: [new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle('⚠️ Aviso de Inatividade')
              .setDescription(`Você fez menos de 1.000 de contribuição e ficou inativo. Por favor, vá para o canal <#1468600851290521692> e leia o lembrete do TGG-Bot para mais informações, evite ser removido da guilda.`)
              .setTimestamp()]
          }).catch(() => console.log(`Could not send DM to ${player.discord_id}`));

          applied++;
        } catch {
          failed++;
        }
      })
    );

    // Executa tudo com concorrência controlada
    await Promise.all(tasks);

    const embed = createSuccessEmbed(
      'Inativos Aplicados',
      `Cargo aplicado em ${applied} usuário(s).\nFalhas: ${failed}`
    );

    await message.reply({ embeds: [embed] });

  } catch (err) {
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Executar inac-all', err.message)]
    });
  }
});

// .inac-list
export const handleInacList = adminOnly(async (message, args, client) => {
  try {
    const inactivePlayers = await getInactivePlayers();

    if (inactivePlayers.length === 0) {
      return message.reply({ embeds: [createErrorEmbed('Sem Inativos', 'Nenhum usuário marcado como inativo no momento')] });
    }

    const itemsPerPage = 10;
    const pages = [];

    for (let i = 0; i < inactivePlayers.length; i += itemsPerPage) {
      const chunk = inactivePlayers.slice(i, i + itemsPerPage);
      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`📋 Usuários Inativos (${inactivePlayers.length})`)
        .setFooter({ text: `Página ${pages.length + 1} de ${Math.ceil(inactivePlayers.length / itemsPerPage)}` });

      for (let j = 0; j < chunk.length; j++) {
        const player = chunk[j];
        const user = await client.users.fetch(player.discord_id).catch(() => null);
        const createdAt = new Date(player.created_at);
        const daysInactive = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        const timeStr = daysInactive === 0 ? 'Hoje' : `${daysInactive}d atrás`;

        embed.addFields({
          name: `${i + j + 1}. ${user?.tag || 'Desconhecido'}`,
          value: `ID: ${player.discord_id}\nMarcado: ${timeStr}`,
          inline: false
        });
      }
      pages.push(embed);
    }

    let currentPage = 0;

    const getRow = (page) => {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('Anterior')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('Próximo')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === pages.length - 1)
      );
      return row;
    };

    const listMsg = await message.reply({
      embeds: [pages[currentPage]],
      components: pages.length > 1 ? [getRow(currentPage)] : []
    });

    if (pages.length > 1) {
      const collector = listMsg.createMessageComponentCollector({ time: 60000 });

      collector.on('collect', async (i) => {
        if (i.user.id !== message.author.id) {
          return i.reply({ content: 'Você não pode usar estes botões.', ephemeral: true });
        }

        if (i.customId === 'prev') currentPage--;
        if (i.customId === 'next') currentPage++;

        await i.update({ embeds: [pages[currentPage]], components: [getRow(currentPage)] });
      });

      collector.on('end', () => {
        listMsg.edit({ components: [] }).catch(() => { });
      });
    }
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Listar Inativos', err.message)] });
  }
});

// .concluida
export const handleConcluida = adminOnly(async (message, args, client) => {
  try {
    const numero = parseInt(args[0]);

    if (!numero || numero < 1 || numero > 4) {
      return message.reply({
        embeds: [createErrorEmbed('Missões', 'Informe um número de 1 a 4.')]
      });
    }

    const missions = await getWeeklyMissions();

    if (!missions || missions.length === 0) {
      return message.reply({
        embeds: [createErrorEmbed('Missões', 'Nenhuma missão encontrada')]
      });
    }

    const mission = missions[numero - 1];

    if (!mission) {
      return message.reply({
        embeds: [createErrorEmbed('Missões', 'Missão inválida')]
      });
    }

    const supabase = getClient();

    const { error } = await supabase
      .from('weekly_missions')
      .update({ status: 'done' })
      .eq('id', mission.id);

    if (error) throw error;

    return message.reply({ embeds: [createSuccessEmbed('Missões', `Missão ${numero} marcada como concluída!`).setTimestamp()] });

  } catch (err) {
    return message.reply({
      embeds: [
        createErrorEmbed('Erro', err.message)
      ]
    });
  }
});

// .cadastrarMissao
export const handleCadastrarMissao = adminOnly(async (message, args, client) => {
  try {
    const input = message.content;

    const match = input.match(/"([^"]+)"\s+"([^"]+)"\s+(\d+)/);

    if (!match) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Missões',
            'Formato inválido.\nUse: .cadastrarMissao "Nome" "Dica" <objetivo>\nUse aspas.\nObjetivo = valor final.'
          )
        ]
      });
    }

    const mission = match[1];
    const tip = match[2];
    const target = parseInt(match[3]);

    const supabase = getClient();

    const weekStart = await getMissionWeekStart();
    const missions = await getWeeklyMissions();

    if (missions.length >= 4) {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Missões',
            'Já existem 4 missões cadastradas para esta semana.'
          )
        ]
      });
    }

    const { error } = await supabase
      .from('weekly_missions')
      .insert([
        {
          week_start: weekStart,
          mission: mission,
          tip: tip,
          target: target,
          status: null
        }
      ]);

    if (error) throw error;

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Missões')
      .setDescription(`Missão cadastrada com sucesso!\n\n🎯 ${mission}`)
      .setTimestamp();

    return message.reply({ embeds: [embed] });

  } catch (err) {
    return message.reply({
      embeds: [
        createErrorEmbed('Erro', err.message)
      ]
    });
  }
});

// .entrou
export const handleEntrou = adminOnly(async (message, args, client) => {
  if (!(await isAdmin(message.author.id))) {
    return message.reply({
      embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
    });
  }

  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    const idMatch = args[0]?.match(/^\d+$/);

    if (!mentionMatch && !idMatch) {
      return message.reply({
        embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.entrou <@user/ID> <brawlhalla_id>`')]
      });
    }

    const targetId = mentionMatch ? mentionMatch[1] : args[0];
    const finalBhid = mentionMatch ? args[1] : args[1];

    if (!finalBhid || !/^\d+$/.test(finalBhid)) {
      return message.reply({
        embeds: [createErrorEmbed('Brawlhalla ID Inválido', 'O Brawlhalla ID deve conter apenas números.')]
      });
    }

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      return message.reply({
        embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
      });
    }

    // Dados do player
    const playerData = await fetchPlayerStats(finalBhid);

    if (!playerData) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Não foi possível encontrar o jogador na API do Brawlhalla.')]
      });
    }

    const playerName = playerData.name || 'Desconhecido';

    const confirmEmbed = createWarningEmbed('Confirmação',
      `Deseja realmente adicionar este usuário?\n\n` +
      `👤 **Discord:** ${member.user.tag}\n` +
      `🎮 **Brawlhalla ID:** ${finalBhid}\n` +
      `🏷️ **Nome:** ${playerName}`
    );

    const { confirmed, interaction } = await awaitConfirmation(message, confirmEmbed, {
      authorId: message.author.id,
      time: 30000,
    });

    if (confirmed === null) return;

    if (!confirmed) {
      return interaction.update({
        embeds: [createErrorEmbed('Operação Cancelada', 'O cadastro do usuário foi cancelado.')],
        components: []
      });
    }

    const result = await reactivateOrAddUser(targetId, finalBhid, member.user.tag);

    const rolesToRemove = ['1466815420630565069', '1478477041077588098', '1437447173896802395'];
    const rolesToAdd = ['1437441679572471940', '1437427750209327297'];

    for (const roleId of rolesToRemove) {
      if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
    }

    for (const roleId of rolesToAdd) {
      if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
    }

    const successEmbed = createSuccessEmbed(
      result.reactivated ? 'Usuário Reativado' : 'Usuário Adicionado',
      `${member.user.tag} foi ${result.reactivated ? 'reativado' : 'adicionado'} ao banco de dados.\n\n` +
      `🎮 **Brawlhalla ID:** ${finalBhid}\n` +
      `🏷️ **Nome:** ${playerName}\n` +
      `🎖️ **Cargo:** Recruit\n\n` +
      `Cargos atualizados com sucesso!`
    );
    return interaction.update({ embeds: [successEmbed], components: [] });

  } catch (err) {
    console.error(err);
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Adicionar Usuário', err.message)]
    });
  }
});

// .escrever {json com https://discohook.org}
export const handleEscrever = adminOnly(async (message, args) => {
  try {

    const raw = args.join(" ").trim();

    if (!raw) {
      return message.channel.send({
        embeds: [
          createErrorEmbed(
            "Uso incorreto",
            "Envie um JSON após .escrever (use o https://discohook.org para criar o JSON de forma fácil)."
          )
        ]
      });
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch (e) {
      return message.channel.send({
        embeds: [
          createErrorEmbed(
            "JSON inválido",
            e.message
          )
        ]
      });
    }

    // Canal opcional
    let targetChannel = message.channel;

    if (data.channel_id) {
      const channel = await message.client.channels
        .fetch(String(data.channel_id))
        .catch(() => null);

      if (!channel || !channel.isTextBased()) {
        return message.channel.send({
          embeds: [
            createErrorEmbed(
              "Canal inválido",
              "channel_id não encontrado."
            )
          ]
        });
      }

      targetChannel = channel;
    }

    // Converter embeds JSON para EmbedBuilder
    let embeds = [];

    if (Array.isArray(data.embeds)) {
      embeds = data.embeds.map(embed => {

        const e = new EmbedBuilder();

        if (embed.title) e.setTitle(embed.title); // Título
        if (embed.description) e.setDescription(embed.description); // Descrição
        if (embed.url) e.setURL(embed.url); // URL do título
        if (embed.color) e.setColor(embed.color); // Cor da borda

        // Timestamp opcional
        if (embed.timestamp)
          e.setTimestamp(
            embed.timestamp === true ? new Date() : new Date(embed.timestamp)
          );

        // Autor opcional
        if (embed.author) {
          e.setAuthor({
            name: embed.author.name,
            iconURL: embed.author.icon_url,
            url: embed.author.url
          });
        }

        // Footer opcional
        if (embed.footer) {
          e.setFooter({
            text: embed.footer.text,
            iconURL: embed.footer.icon_url
          });
        }

        // Imagens opcionais
        if (embed.thumbnail?.url) {
          e.setThumbnail(embed.thumbnail.url);
        }

        // Imagem principal opcional
        if (embed.image?.url) {
          e.setImage(embed.image.url);
        }

        // Campos opcionais
        if (Array.isArray(embed.fields)) {
          e.addFields(
            embed.fields.map(f => ({
              name: f.name,
              value: f.value,
              inline: !!f.inline
            }))
          );
        }

        return e;
      });
    }

    // Payload completo estilo webhook
    const payload = {
      content: data.content || undefined,
      embeds
    };

    // Attachments opcionais
    if (
      Array.isArray(data.attachments) &&
      data.attachments.length
    ) {
      payload.files = data.attachments;
    }

    await targetChannel.send(payload);

  } catch (err) {
    await message.channel.send({
      embeds: [
        createErrorEmbed(
          "Erro ao enviar embed",
          err.message
        )
      ]
    });
  }
});

// .organize-tickets (Organiza os tickets dentro da categoria de tickets, renomeando e reordenando baseado no número no final do nome do canal)
export const handleOrganizeTickets = adminOnly(async (message, args, client) => {
  const loading = await message.reply({ embeds: [createLoadingEmbed(`${EMOJIS.loading} Organizando tickets...`, 'Reordenando e renomeando canais...')] });

  try {
    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    const categoryId = '1460768037518180352'; // ID da categoria de tickets
    const category = guild.channels.cache.get(categoryId);

    if (!category) throw new Error('Categoria não encontrada');

    // pega apenas canais de texto dentro da categoria
    let channels = guild.channels.cache
      .filter(c => c.parentId === categoryId && c.isTextBased());

    // transforma em array
    channels = Array.from(channels.values());

    // ordena baseado no número no final do nome
    channels.sort((a, b) => {
      const getNumber = (name) => {
        const match = name.match(/-(\d+)$/);
        return match ? parseInt(match[1]) : 9999;
      };
      return getNumber(a.name) - getNumber(b.name);
    });

    let position = 0;

    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];

      // extrai base do nome (sem o número final)
      const baseName = channel.name.replace(/-\d+$/, '');

      const newName = `${baseName}-${i + 1}`;

      // renomeia se necessário
      if (channel.name !== newName) {
        await channel.setName(newName).catch(() => {});
      }

      // reposiciona
      await channel.setPosition(position++).catch(() => {});

      // envia mensagem no ticket
      await channel.send({
        content: `Prioridade ajustada, consulte a sua posição na fila de espera no nome do seu ticket\nLembrando que conforme a sua interação no servidor, seja por calls ou mensagens, sua prioridade será maior`
      }).catch(() => {});
    }

    await sendCleanMessage(loading, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`${EMOJIS.check} Tickets organizados`)
          .setDescription(`${channels.length} canais atualizados.`)
      ]
    });

  } catch (err) {
    await sendCleanMessage(loading, {
      embeds: [createErrorEmbed('Erro ao organizar tickets', err.message)]
    }).catch(() => {});
  }
});

// .abrir-tickets
export const handleAbrirTickets = adminOnly(async (message) => {
  try {
    // Canal dos tickets
    const ticketsChannelId = ticketsConfig.entrarNaGuildaChannelId;

    // Canal de Fila guilda
    const logChannelId = ticketsConfig.filaGuildaChannelId;

    const guild = message.guild;

    const ticketsChannel = guild.channels.cache.get(ticketsChannelId);
    const logChannel = guild.channels.cache.get(logChannelId);

    if (!ticketsChannel) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Canal de tickets não encontrado.')]
      });
    }

    await ticketsChannel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: true
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('🟢 Tickets Abertos')
      .setDescription(`Usem o canal <#${ticketsChannelId}> para abrir um ticket e entrar na fila de espera!`)
      .setFooter({text: `Aberto por ${message.author.displayName}`})
      .setTimestamp();

    const roleId = ticketsConfig.filaDeEsperaRoleId;

    if (logChannel) {
      await logChannel.send({
        content: `<@&${roleId}>`,
        embeds: [embed]
      });
    }
    
  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro ao abrir tickets', err.message)]
    });
  }
});

// .fechar-tickets
export const handleFecharTickets = adminOnly(async (message) => {
  try {
    // Canal dos tickets
    const ticketsChannelId = ticketsConfig.entrarNaGuildaChannelId;

    // Canal de Fila guilda
    const logChannelId = ticketsConfig.filaGuildaChannelId;

    const guild = message.guild;

    const ticketsChannel = guild.channels.cache.get(ticketsChannelId);
    const logChannel = guild.channels.cache.get(logChannelId);

    if (!ticketsChannel) {
      return message.reply({
        embeds: [createErrorEmbed('Erro', 'Canal de tickets não encontrado.')]
      });
    }

    await ticketsChannel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false
    });

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🔴 Tickets Fechados')
      .setDescription('Os tickets foram fechados temporariamente.')
      .setFooter({
        text: `Fechado por ${message.author.displayName}`
      })
      .setTimestamp();

    const roleId = ticketsConfig.filaDeEsperaRoleId;

    if (logChannel) {
      await logChannel.send({
        embeds: [embed]
      });
    }

  } catch (err) {
    return message.reply({
      embeds: [createErrorEmbed('Erro ao fechar tickets', err.message)]
    });
  }
});

// .justificativas <@usuario/id>
export const handleJustificativas = adminOnly(async (message, args) => {
  try {
    const mentionMatch = message.content.match(/<@!?(\d+)>/);
    const idMatch = args[0]?.match(/^\d+$/);

    if (!mentionMatch && !idMatch) {
      return await message.reply({embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.justificativas <@usuario/ID>`')]});
    }

    const targetUserId = mentionMatch ? mentionMatch[1] : args[0];
    const brawlhallaId = await getUserBrawlhallaId(targetUserId);

    if (!brawlhallaId) {
      return await message.reply({embeds: [createErrorEmbed('Brawlhalla ID Não Encontrado', 'Este usuário não tem um Brawlhalla ID registrado.')]});
    }

    const justifications = await getMemberJustifications(brawlhallaId);

    if (!justifications || justifications.length === 0) {
      return await message.reply({embeds: [createWarningEmbed('Nenhuma Justificativa', 'Este usuário não possui justificativas registradas.')]});
    }

    const ITEMS_PER_PAGE = 5;
    const totalPages = Math.ceil(justifications.length / ITEMS_PER_PAGE);

    let currentPage = 0;

    function generateEmbed(page) {
      const start = page * ITEMS_PER_PAGE;
      const end = start + ITEMS_PER_PAGE;

      const currentItems = justifications.slice(start, end);
      const description = currentItems.map((item, index) => {
      const createdAt = formatDateBR(item.created_at);

        return (
          `### ${start + index + 1}° Justificativa \n` +
          `🕒 **Justificado em:** ${createdAt}\n` +
          `📝 **Justificativa:**\n${item.note || 'Sem justificativa'}`
        );

      }).join('\n\n');

      return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📋 Justificativas do Usuário')
        .setDescription(description)
        .addFields({
          name: '👤 Usuário',
          value: `<@${targetUserId}>`,
          inline: false
        })
        .setFooter({
          text: `Página ${page + 1} de ${totalPages}`
        })
        .setTimestamp();
    }

    function generateButtons(page) {

      return new ActionRowBuilder().addComponents(

        new ButtonBuilder()
          .setCustomId('just_prev')
          .setLabel('⬅️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),

        new ButtonBuilder()
          .setCustomId('just_next')
          .setLabel('➡️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)

      );
    }

    const response = await message.reply({
      embeds: [generateEmbed(currentPage)],
      components: totalPages > 1
        ? [generateButtons(currentPage)]
        : []
    });

    if (totalPages <= 1) {
      return;
    }

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000
    });

    collector.on('collect', async (interaction) => {

      if (interaction.user.id !== message.author.id) {
        return interaction.reply({
          content: 'Apenas quem executou o comando pode usar os botões.',
          ephemeral: true
        });
      }

      if (interaction.customId === 'just_prev') {
        currentPage--;
      }

      if (interaction.customId === 'just_next') {
        currentPage++;
      }

      await interaction.update({
        embeds: [generateEmbed(currentPage)],
        components: [generateButtons(currentPage)]
      });

    });

    collector.on('end', async () => {
      await response.edit({
        components: []
      }).catch(() => {});
    });

  } catch (err) {
    console.error(err);
    return await message.reply({
      embeds: [
        createErrorEmbed(
          'Erro',
          err.message
        )
      ]
    });
  }
});
