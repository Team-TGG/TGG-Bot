// admin.js - Comandos apenas para administradores
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, Events, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createClient, runSync, runEloSync } from './discord.js';
import { addWarning, getUserWarnings, removeWarning, removeLastWarning, parseTime, formatTime as formatModTime, safeSetTimeout } from './moderation.js';
import { getUsers, getUsersWithElo, getUserByDiscordId, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, getClient, reactivateOrAddUser, addPersistentMute, removePersistentMute, getActiveMutes, getMissionWeekStart, getActiveUser } from './db.js';
import { discord as discordConfig, ALLOWED_USER_IDS, inactivePlayers as inactivePlayersConfig } from '../config/index.js';
import { loadCustomNicknames } from './customNicknames.js';
import { syncNicknames, updateMemberNicknameDiscordPortion, parseNickname, buildNickname, fetchBrawlhallaClanData, loadClanCache } from './nicknameSync.js';
import { createErrorEmbed, createSuccessEmbed, sendCleanMessage } from '../utils/discordUtils.js';
import { isAdmin, adminOnly} from '../utils/permissions.js';
import { EMOJIS } from '../config/emojis.js';

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
  const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Executando sincronização completa...')] });
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

// .sync-nick
export const handleSyncNick = adminOnly(async (message, args, client) => {
  const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Sincronizando apelidos com clan Brawlhalla...')] });
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
  const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Atualizando...`).setDescription('Atualizando cache do clan Brawlhalla...')] });
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
      return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.warn <@user/ID> [motivo]`')] });
    }

    if (await isAdmin(targetId)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode dar um aviso a um administrador.')] });
    }

    const reason = message.content.includes('>')
      ? message.content.split('>').slice(1).join('>').trim()
      : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });

    const warningCount = await addWarning(targetId, message.author.id, reason);
    await message.reply({ embeds: [createSuccessEmbed('Aviso Adicionado', `${member.user.tag} recebeu um aviso.\n**Motivo:** ${reason}\n**Total de avisos:** ${warningCount}/3`)] });

    if (warningCount === 2) {
      let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
      if (!muteRole) muteRole = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'Cargo para silenciados' });
      await member.roles.add(muteRole);
      setTimeout(() => member.roles.remove(muteRole).catch(() => { }), 15 * 60 * 1000);
      await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle('⚠️ Mute Automático').setDescription(`${member.user.tag} foi silenciado por 15 minutos (2 avisos).`)] });
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

// .unwarn
export const handleUnwarn = adminOnly(async (message, args, client) => {
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

// .warns
export const handleWarns = adminOnly(async (message, args, client) => {
  try {
    const page = parseInt(args[0]) || 1;
    const pageSize = 10;
    const dbClient = getClient();
    const { data: allWarnings, error } = await dbClient.from('warnings').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    if (!allWarnings || allWarnings.length === 0) return message.reply({ embeds: [createErrorEmbed('Sem Avisos', 'Nenhum aviso encontrado no sistema.')] });

    const byUser = {};
    allWarnings.forEach(w => {
      if (!byUser[w.user_id]) byUser[w.user_id] = { user_id: w.user_id, warnings: [], latest: w.created_at };
      byUser[w.user_id].warnings.push(w);
      if (new Date(w.created_at) > new Date(byUser[w.user_id].latest)) byUser[w.user_id].latest = w.created_at;
    });
    const sorted = Object.values(byUser).sort((a, b) => new Date(b.latest) - new Date(a.latest));
    const totalPages = Math.ceil(sorted.length / pageSize);
    const pageData = sorted.slice((page - 1) * pageSize, page * pageSize);
    if (pageData.length === 0) return message.reply({ embeds: [createErrorEmbed('Página Inválida', `Apenas ${totalPages} página(s) disponíveis.`)] });

    const embed = new EmbedBuilder().setColor(0xfaa61a).setTitle(`⚠️ Lista de Avisos (${page}/${totalPages})`).setDescription(`${sorted.length} usuários com avisos`).setTimestamp();
    for (const ud of pageData) {
      const user = await client.users.fetch(ud.user_id).catch(() => null);
      embed.addFields({ name: `${ud.warnings.length} avisos — ${user?.tag || ud.user_id}`, value: `Último: ${new Date(ud.latest).toLocaleDateString('pt-BR')}\n${ud.warnings.slice(0, 2).map(w => `• ${w.reason}`).join('\n')}`, inline: false });
    }

    const navRow = new ActionRowBuilder();
    if (page > 1) navRow.addComponents(new ButtonBuilder().setCustomId(`warns_${page - 1}`).setLabel('⬅️').setStyle(2));
    navRow.addComponents(new ButtonBuilder().setLabel(`${page}/${totalPages}`).setStyle(2).setDisabled(true).setCustomId('page_label'));
    if (page < totalPages) navRow.addComponents(new ButtonBuilder().setCustomId(`warns_${page + 1}`).setLabel('➡️').setStyle(2));

    const reply = await message.reply({ embeds: [embed], components: navRow.components.length > 1 ? [navRow] : [] });
    const col = reply.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 60000 });
    col.on('collect', async i => {
      const np = parseInt(i.customId.split('_')[1]);
      const nd = sorted.slice((np - 1) * pageSize, np * pageSize);
      const ne = new EmbedBuilder().setColor(0xfaa61a).setTitle(`⚠️ Lista de Avisos (${np}/${totalPages})`).setDescription(`${sorted.length} usuários com avisos`).setTimestamp();
      for (const ud of nd) {
        const user = await client.users.fetch(ud.user_id).catch(() => null);
        ne.addFields({ name: `${ud.warnings.length} avisos — ${user?.tag || ud.user_id}`, value: `Último: ${new Date(ud.latest).toLocaleDateString('pt-BR')}\n${ud.warnings.slice(0, 2).map(w => `• ${w.reason}`).join('\n')}`, inline: false });
      }
      const nr = new ActionRowBuilder();
      if (np > 1) nr.addComponents(new ButtonBuilder().setCustomId(`warns_${np - 1}`).setLabel('⬅️').setStyle(2));
      nr.addComponents(new ButtonBuilder().setLabel(`${np}/${totalPages}`).setStyle(2).setDisabled(true).setCustomId('page_label'));
      if (np < totalPages) nr.addComponents(new ButtonBuilder().setCustomId(`warns_${np + 1}`).setLabel('➡️').setStyle(2));
      await i.update({ embeds: [ne], components: nr.components.length > 1 ? [nr] : [] });
    });
    col.on('end', () => reply.edit({ components: [] }).catch(() => { }));
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Listar Avisos', err.message)] });
  }
});

// .mute
export const handleMute = adminOnly(async (message, args, client) => {
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
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Desmutado').setDescription(`${m.user.tag} desmutado automaticamente.`)] }).catch(() => { });
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

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.ban <@user/ID> [motivo]`')] });

    if (await isAdmin(targetId)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode banir um administrador.')] });
    }

    const reason = message.content.includes('>')
      ? message.content.split('>').slice(1).join('>').trim()
      : args.slice(1).join(' ').trim() || 'Sem motivo especificado';

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });
    await member.ban({ reason });
    await message.reply({ embeds: [createSuccessEmbed('Banido', `${member.user.tag} foi banido.\n**Motivo:** ${reason}`)] });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Banir', err.message)] });
  }
});

// .inac-all
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

    for (const player of inactivePlayers) {
      try {
        const member = await guild.members.fetch(player.discord_id).catch(() => null);
        if (!member) {
          failed++;
          continue;
        }

        if (!member.roles.cache.has(inactiveRoleId)) {
          await member.roles.add(inactiveRoleId);
        }

        // Notificação por DM
        await member.send({
          embeds: [new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('⚠️ Aviso de Inatividade')
            .setDescription(`Você está inativo. Para mostrar que está ativo, use o comando \`.active <justificativa>\` no canal <#1468600851290521692>.`)
            .setTimestamp()]
        }).catch(() => console.log(`Could not send DM to ${player.discord_id}`));

        applied++;
      } catch {
        failed++;
      }
    }

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
          .setStyle(1) // Primary
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('Próximo')
          .setStyle(1) // Primary
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

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Missões')
      .setDescription(`Missão ${numero} marcada como concluída!`)
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
    const brawlhallaId = mentionMatch ? args[1] : args[1]; // Correct args index depending on input

    // Re-evaluate args if it was an ID
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

    const result = await reactivateOrAddUser(targetId, brawlhallaId, member.user.tag);

    const rolesToRemove = ['1466815420630565069', '1478477041077588098', '1437447173896802395'];
    const rolesToAdd = ['1437441679572471940', '1437427750209327297'];

    for (const roleId of rolesToRemove) {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
      }
    }

    for (const roleId of rolesToAdd) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
      }
    }

    const embed = createSuccessEmbed(
      result.reactivated ? 'Usuário Reativado' : 'Usuário Adicionado',
      `${member.user.tag} foi ${result.reactivated ? 'reativado' : 'adicionado'} ao banco de dados.\n**Brawlhalla ID:** ${brawlhallaId}\n**Cargo:** Recruit\n\nCargos atualizados com sucesso!`
    );

    await message.reply({ embeds: [embed] });

  } catch (err) {
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Adicionar Usuário', err.message)]
    });
  }
});
