// admin.js - Comandos apenas para administradores
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Events, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createClient, runSync, runEloSync } from './discord.js';
import { fetchPlayerStats, getUserBrawlhallaId, fetchPlayerGuildStatsNewAPI } from './brawlhalla.js';
import { calculateGames, calculateGamesFromClosedWeek } from './handlers/publicHandlers.js';
import { addWarning, getUserWarnings, removeWarning, removeLastWarning, editWarning, deleteExpiredWarnings, parseTime, formatTime as formatModTime } from './moderation.js';
import { getUsers, getAllUsers, getUsersWithElo, getAllUsersWithElo, getUserByDiscordId, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, getClient, reactivateOrAddUser, addPersistentMute, removePersistentMute, getMissionWeekStart, getActiveUser, getMemberJustifications, formatDateBR, getMembershipHistory, getPreviousMissionWeekStart, getWeeklyInitial, getMissionWeekStartDateTime, formatCreatedAtBR, loadAliases, resolveBrawlhallaId, getLastWednesdayReference } from './db.js';
import { discord as discordConfig, STAFF_ROLE_IDS, inactivePlayers as inactivePlayersConfig, tickets as ticketsConfig } from '../config/index.js';
import { loadCustomNicknames } from './customNicknames.js';
import { syncNicknames, updateMemberNicknameDiscordPortion, parseNickname, buildNickname, fetchBrawlhallaClanData, loadClanCache } from './nicknameSync.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed, createLoadingEmbed, sendCleanMessage, awaitConfirmation } from '../utils/discordUtils.js';
import { isAdmin, adminOnly, hasPermission, getMemberLevel} from '../utils/permissions.js';
import { EMOJIS } from '../config/emojis.js';
import { scheduleTemporaryWarningRemoval } from './services/warningManager.js';
import { scheduleMuteRenewal } from './services/muteManager.js';
import { ensurePlayerWeeklyInfo } from './tggCoins.js';
import { getBlindagensAprovadas, getBlindagensPendentes, cobreSemana, ehPermanente, fimDaBlindagem } from './inactivity.js';
import { calcularInativosDaSemana, inativarSemana, CONTRIBUICAO_MINIMA, LIMIAR_INATIVACAO, TOLERANCIA_INATIVACAO } from './services/weeklyInactiveService.js';

// Funções auxiliares

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
      embeds: [createWarningEmbed('Aviso Recebido', `Você recebeu um warn/aviso.\n**Motivo:** ${reason}${durationLine}${expiresLine}\n**Total de avisos:** ${warningCount}/3`)]
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
      await member.timeout(15 * 60 * 1000, '2 avisos acumulados').catch(() => { });
      await message.channel.send({ embeds: [createWarningEmbed('Mute Automático', `${member.user.tag} foi silenciado por 15 minutos (2 avisos).`)] });
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

    // Apenas assistants/helpers ou superiores podem usar esse comando
    if (!hasPermission(message.member, 1)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas assistants, helpers ou superiores podem dar avisos.')]
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
      embeds: [createSuccessEmbed('Aviso Adicionado', `${member.user.tag} recebeu um aviso.\n**Motivo:** ${reason}\n**Total de avisos:** ${fakeWarnings}/3`).setFooter({text: 'Este comando é fake e não faz absolutamente nada.'})
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

    let targetId, warningNumber, newReason;

    if (message.interaction) {
      // Slash: options tipadas
      const u = message.interaction.options.getUser('usuario');
      warningNumber = message.interaction.options.getInteger('numero');
      newReason = message.interaction.options.getString('motivo');
      if (!u || !warningNumber || !newReason) {
        return message.reply({
          embeds: [createErrorEmbed('Formato Inválido', 'Uso: `/edit-warn usuario:N número:N motivo:"..."`')]
        });
      }
      targetId = u.id;
    } else {
      // Prefix fallback
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

      const afterMention = mentionMatch
        ? message.content.slice(message.content.indexOf(mentionMatch[0]) + mentionMatch[0].length).trim()
        : args.slice(1).join(' ').trim();

      const warnNumMatch = afterMention.match(/^(\d+)\s+/);
      if (!warnNumMatch) {
        return message.reply({
          embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.edit-warn <@user/ID> <número> "Motivo"`')]
        });
      }

      warningNumber = parseInt(warnNumMatch[1]);
      newReason = afterMention.slice(warnNumMatch[0].length).replace(/^["']|["']$/g, '').trim();
    }

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
            embeds: [createErrorEmbed('Sem Permissão', 'Você só pode visualizar seus próprios avisos.')]
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
        embeds: [createErrorEmbed('Sem Avisos', viewingOthers ? 'Este usuário não possui avisos.' : 'Você não possui avisos.')]
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
        embeds: [createErrorEmbed('Sem Avisos', 'Nenhum aviso válido encontrado.')]
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

    if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.mute <@user/ID> <duração> [motivo]` - ex: `.mute @user 1h sendo tóxico`')] });

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

    const expiresAt = new Date(Date.now() + durationMs).toISOString();
    await addPersistentMute(targetId, expiresAt);
    await scheduleMuteRenewal(guild, targetId, expiresAt, message.channel);

    await message.reply({ embeds: [createSuccessEmbed('Silenciado', `${member.user.tag} silenciado por ${formatModTime(durationMs)}.\n**Motivo:** ${reason}`)] });
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
    if (!member.isCommunicationDisabled()) return message.reply({ embeds: [createErrorEmbed('Não Silenciado', 'Este usuário não está silenciado.')] });
    await member.timeout(null).catch(() => { });
    await removePersistentMute(targetId);
    await message.reply({ embeds: [createSuccessEmbed('Desmutado', `${member.user.tag} desmutado com sucesso.`)] });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Desmutar', err.message)] });
  }
});

// .kick
export const handleKick = adminOnly(async (message, args, client) => {
  try {
    if (!hasPermission(message.member, 3)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas supervisores ou superiores podem kickar.')]
      });
    }

    const guild = client.guilds.cache.get(discordConfig.guildId);
    if (!guild) throw new Error('Guild não encontrada');

    let targetId;
    if (message.interaction) {
      const u = message.interaction.options.getUser('usuario');
      if (!u) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Mencione um usuário.')] });
      targetId = u.id;
    } else {
      const mentionMatch = message.content.match(/<@!?(\d+)>/);
      if (mentionMatch) targetId = mentionMatch[1];
      else {
        const idMatch = args[0]?.match(/^\d+$/);
        if (idMatch) targetId = args[0];
      }
      if (!targetId) return message.reply({ embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.kick <@user/ID> [motivo]`')] });
    }

    if (await isAdmin(targetId)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Você não pode kickar um administrador.')] });
    }

    let reason;
    if (message.interaction) {
      reason = message.interaction.options.getString('motivo') || 'Sem motivo especificado';
    } else {
      reason = message.content.includes('>')
        ? message.content.split('>').slice(1).join('>').trim()
        : args.slice(1).join(' ').trim() || 'Sem motivo especificado';
    }

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')] });
    }

    // DM antes de kickar
    await member.send({
      embeds: [createWarningEmbed('Você foi expulso', `Você foi removido da guilda TGG.\n**Motivo:** ${reason}`)]
    }).catch(() => console.log(`[Kick] Could not send DM to ${targetId}`));

    await member.kick(reason);

    await message.reply({ embeds: [createSuccessEmbed('Usuário Expulso', `${member.user.tag} foi kickado.\n**Motivo:** ${reason}`)] });
  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Kickar', err.message)] });
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
      return interaction.editReply({
        embeds: [createErrorEmbed('Ação Cancelada', 'O banimento foi cancelado.')],
        components: []
      });
    }

    await member.ban({ reason });

    await interaction.editReply({
      embeds: [createSuccessEmbed('Usuário Banido', `${member.user.tag} foi banido.\n**Motivo:** ${reason}`)],
      components: []
    });

  } catch (err) {
    await message.reply({ embeds: [createErrorEmbed('Erro ao Banir', err.message)] });
  }
});

// .bam
export const handleBam = adminOnly(async (message, args, client) => {
  try {

    // Apenas assistants/helpers ou superiores podem usar esse comando
    if (!hasPermission(message.member, 1)) {
      return message.reply({
        embeds: [createErrorEmbed('Acesso Negado', 'Apenas Assistant, Helper ou superiores podem usar o .bam.')]
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
        embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.bam <@user/ID> [motivo]`')]
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

    const confirmEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('⚠️ Confirmação de BAM')
      .setDescription('Você está prestes a aplicar um BAM no usuário abaixo:')
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
      return interaction.editReply({
        embeds: [createErrorEmbed('Ação Cancelada', 'O BAM foi cancelado.')],
        components: []
      });
    }

    const fakeEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🔨 BAM Aplicado')
      .setDescription(`${member.user.tag} recebeu um BAM com sucesso.`)
      .addFields({
        name: 'Motivo',
        value: reason
      })
      .setFooter({
        text: 'Este comando é fake e não faz absolutamente nada.'
      });

    await interaction.editReply({
      embeds: [fakeEmbed],
      components: []
    });

  } catch (err) {
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Aplicar BAM', err.message)]
    });
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

    const embed = createSuccessEmbed('Inativos Aplicados', `Cargo aplicado em ${applied} usuário(s).\nFalhas: ${failed}`);

    await message.reply({ embeds: [embed] });

  } catch (err) {
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Executar inac-all', err.message)]
    });
  }
});

// .inativar - o que antes era feito na mão na página "inativar players" do site
export const handleInativar = adminOnly(async (message, args, client) => {
  const loading = await message.reply({
    embeds: [createLoadingEmbed(`${EMOJIS.loading} Calculando...`, 'Medindo a contribuição da semana de todo mundo.')]
  });

  try {
    const { weekReference, inativos, poupados, pendentes, fechada } = await calcularInativosDaSemana();

    const contagem = (motivo) => poupados.filter(p => p.motivoPoupado === motivo).length;
    const semMedicao = poupados.filter(p => p.motivo).length;

    const [ano, mes, dia] = weekReference.split('-');

    // Fora da janela quarta 06:00 → quinta 06:00 o número não descreve a semana: antes está
    // parcial, depois a base já virou e todo mundo aparece com ~0. Mostra a prévia, mas não deixa
    // confirmar - o estrago seria cargo e DM em massa em cima de número errado.
    if (!fechada) {
      return sendCleanMessage(loading, {
        embeds: [createErrorEmbed(
          'Fora da janela de medição',
          `A semana ainda não fechou. A contribuição só pode ser cobrada entre **quarta 06:00** e ` +
          `**quinta 06:00** - antes disso o número está pela metade, e depois a base já virou para ` +
          `a semana nova (todo mundo apareceria com zero).\n\n` +
          `O cron roda sozinho na quarta às 06:10. Se precisar rodar na mão, é nessa janela.`
        )]
      });
    }

    if (!inativos.length) {
      return sendCleanMessage(loading, {
        embeds: [createSuccessEmbed(
          'Ninguém para inativar',
          `Semana de **${dia}/${mes}/${ano}**: todo mundo passou de ${LIMIAR_INATIVACAO.toLocaleString('pt-BR')} ` +
          `de contribuição, está blindado ou já está na lista.\n\n` +
          `Já na lista: **${contagem('JA_NA_LISTA')}** • Blindados: **${contagem('BLINDADO')}** • ` +
          `Staff: **${contagem('STAFF')}** • Na tolerância: **${contagem('TOLERANCIA')}** • ` +
          `Sem medição: **${semMedicao}**`
        )]
      });
    }

    // A lista pode passar do limite de um embed; o corte deixa explícito que há mais
    const MOSTRAR = 25;
    const lista = inativos.slice(0, MOSTRAR)
      .map((i, n) => `\`${String(n + 1).padStart(2)}\` <@${i.discordId}> - **${i.contribuicao.toLocaleString('pt-BR')}**`)
      .join('\n');

    const resto = inativos.length > MOSTRAR ? `\n… e mais **${inativos.length - MOSTRAR}**.` : '';

    const previa = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle(`⚠️ Inativar ${inativos.length} membro(s)?`)
      .setDescription(
        `Semana de **${dia}/${mes}/${ano}** - abaixo de ${LIMIAR_INATIVACAO.toLocaleString('pt-BR')} de ` +
        `contribuição (mínimo de ${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')} com ` +
        `${Math.round(TOLERANCIA_INATIVACAO * 100)}% de tolerância para erro da API).\n\n` +
        `${lista}${resto}`
      )
      .addFields(
        {
          name: 'Fora da conta',
          value:
            `🛡️ Blindados: **${contagem('BLINDADO')}**\n` +
            `👮 Staff: **${contagem('STAFF')}**\n` +
            `🆕 Entrou na semana: **${contagem('ENTROU_NA_SEMANA')}**\n` +
            `📏 Na tolerância: **${contagem('TOLERANCIA')}**\n` +
            `❔ Sem medição: **${semMedicao}**\n` +
            `📋 Já na lista: **${contagem('JA_NA_LISTA')}**`,
          inline: true,
        },
        {
          name: 'O que vai acontecer',
          value: '• Grava em `weekly_inactive_players`\n• Aplica o cargo de inativo\n• Manda DM para cada um\n• Avisa no canal de inativos',
          inline: true,
        },
      )
      .setFooter({ text: `Confirmando, ${inativos.length} pessoa(s) recebem o cargo e a DM.` });

    if (pendentes.length) {
      previa.addFields({
        name: `⏳ ${pendentes.length} justificativa(s) esperando decisão`,
        value: pendentes.map(p => `<@${p.discord_id}>`).join(' ').slice(0, 1024)
          + '\n_Pedido pendente não blinda ninguém - decida antes de confirmar._',
        inline: false,
      });
    }

    await loading.delete().catch(() => {});

    const { confirmed, interaction } = await awaitConfirmation(message, previa, {
      authorId: message.author.id,
      confirmLabel: 'Inativar',
      cancelLabel: 'Cancelar',
    });

    if (!confirmed) {
      if (interaction) {
        await interaction.editReply({
          embeds: [createErrorEmbed('Cancelado', 'Ninguém foi inativado.')],
          components: [],
        });
      }
      return;
    }

    await interaction.editReply({
      embeds: [createLoadingEmbed(`${EMOJIS.loading} Inativando...`, 'Gravando a lista, aplicando cargo e mandando as mensagens.')],
      components: [],
    });

    const resultado = await inativarSemana(client);

    const falhas = resultado.falhas?.length
      ? `\n\n⚠️ **${resultado.falhas.length} falha(s):**\n` +
        resultado.falhas.slice(0, 10).map(f => `• ${f.nome ?? f.discordId}: ${f.erro}`).join('\n')
      : '';

    await interaction.editReply({
      embeds: [createSuccessEmbed(
        'Inativos aplicados',
        `Semana de **${dia}/${mes}/${ano}**\n\n` +
        `📋 Gravados: **${resultado.gravados}**\n` +
        `🏷️ Cargo aplicado: **${resultado.cargoAplicado}**\n` +
        `✉️ DMs entregues: **${resultado.dmEnviada}**\n` +
        `📢 Aviso no canal: ${resultado.anunciado ? 'enviado' : '**falhou**'}${falhas}`
      )],
      components: [],
    });

  } catch (err) {
    await sendCleanMessage(loading, {
      embeds: [createErrorEmbed('Erro ao Inativar', err.message)]
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
      embeds: [createErrorEmbed('Erro', err.message)]
    });
  }
});

// .cadastrarMissao
export const handleCadastrarMissao = adminOnly(async (message, args, client) => {
  try {
    let mission, tip, target;

    if (message.interaction) {
      // Slash: options tipadas
      mission = message.interaction.options.getString('nome');
      tip = message.interaction.options.getString('dica');
      target = message.interaction.options.getInteger('objetivo');
      if (!mission || !tip || !target) {
        return message.reply({ embeds: [createErrorEmbed('Missões', 'Parâmetros ausentes.')] });
      }
    } else {
      // Prefix fallback
      const input = message.content;
      const match = input.match(/"([^"]+)"\s+"([^"]+)"\s+(\d+)/);
      if (!match) {
        return message.reply({
          embeds: [createErrorEmbed('Missões', 'Formato inválido.\nUse: .cadastrarMissao "Nome" "Dica" <objetivo>\nUse aspas.\nObjetivo = valor final.')]
        });
      }
      mission = match[1];
      tip = match[2];
      target = parseInt(match[3]);
    }

    const supabase = getClient();

    const weekStart = await getMissionWeekStart();
    const missions = await getWeeklyMissions();

    if (missions.length >= 4) {
      return message.reply({
        embeds: [createErrorEmbed('Missões', 'Já existem 4 missões cadastradas para esta semana.')]
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
      embeds: [createErrorEmbed('Erro', err.message)]
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
      return interaction.editReply({
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

    // Cria os dados iniciais da semana. Sem eles o .conquistas não tem base de comparação e o jogador só entraria na contagem depois do próximo cron do site
    let weeklyInfoNote = '';

    try {
      const weeklyInfo = await ensurePlayerWeeklyInfo(finalBhid);

      weeklyInfoNote = weeklyInfo.created
        ? `📊 **Semana:** dados iniciais registrados`
        : `📊 **Semana:** dados iniciais já existiam`;

    } catch (err) {
      console.error('[Entrou] Erro ao registrar dados iniciais da semana:', err);
      weeklyInfoNote = `⚠️ **Semana:** não foi possível registrar os dados iniciais (serão criados pelo cron em até 15 min)`;
    }

    const successEmbed = createSuccessEmbed(
      result.reactivated ? 'Usuário Reativado' : 'Usuário Adicionado',
      `${member.user.tag} foi ${result.reactivated ? 'reativado' : 'adicionado'} ao banco de dados.\n\n` +
      `🎮 **Brawlhalla ID:** ${finalBhid}\n` +
      `🏷️ **Nome:** ${playerName}\n` +
      `🎖️ **Cargo:** Recruit\n` +
      `${weeklyInfoNote}\n\n` +
      `Cargos atualizados com sucesso!`
    );
    return interaction.editReply({ embeds: [successEmbed], components: [] });

  } catch (err) {
    console.error(err);
    await message.reply({
      embeds: [createErrorEmbed('Erro ao Adicionar Usuário', err.message)]
    });
  }
});

// .escrever {json com https://discohook.org}
export const handleEscrever = adminOnly(async (message, args, client) => {
  if (message.interaction) {
    const interaction = message.interaction;
    const canalOpt = interaction.options.getChannel('canal');
    const channel = (canalOpt && canalOpt.isTextBased?.()) ? canalOpt : interaction.channel;

    const modal = new ModalBuilder()
      .setCustomId(`escrever_modal:${channel.id}`)
      .setTitle('Escrever Mensagem');

    const conteudo = new TextInputBuilder()
      .setCustomId('conteudo')
      .setLabel('Conteúdo (texto puro, sem embed)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000);

    const titulo = new TextInputBuilder()
      .setCustomId('titulo')
      .setLabel('Título do embed')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256);

    const descricao = new TextInputBuilder()
      .setCustomId('descricao')
      .setLabel('Descrição do embed')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(4000);

    const cor = new TextInputBuilder()
      .setCustomId('cor')
      .setLabel('Cor (hex #FF0000 ou nome) - opcional')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(20)
      .setPlaceholder('#5865F2');

    const imagem = new TextInputBuilder()
      .setCustomId('imagem')
      .setLabel('URL da imagem - opcional')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(conteudo),
      new ActionRowBuilder().addComponents(titulo),
      new ActionRowBuilder().addComponents(descricao),
      new ActionRowBuilder().addComponents(cor),
      new ActionRowBuilder().addComponents(imagem),
    );

    return interaction.showModal(modal);
  }

  // Prefix fallback: JSON inline (Discohook). Mantido durante teste até o corte do prefix.
  try {
    const raw = args.join(" ").trim();

    if (!raw) {
      return message.channel.send({
        embeds: [createErrorEmbed("Uso incorreto", "Envie um JSON após .escrever (use o https://discohook.org para criar o JSON de forma fácil).")]
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return message.channel.send({
        embeds: [createErrorEmbed("JSON inválido", e.message)]
      });
    }

    let targetChannel = message.channel;
    if (data.channel_id) {
      const channel = await client.channels.fetch(String(data.channel_id)).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return message.channel.send({
          embeds: [createErrorEmbed("Canal inválido", "channel_id não encontrado.")]
        });
      }
      targetChannel = channel;
    }

    const payload = { content: data.content || undefined };
    if (Array.isArray(data.embeds)) {
      payload.embeds = data.embeds.map(embed => {
        const e = new EmbedBuilder();
        if (embed.title) e.setTitle(embed.title);
        if (embed.description) e.setDescription(embed.description);
        if (embed.url) e.setURL(embed.url);
        if (embed.color) e.setColor(embed.color);
        if (embed.timestamp) e.setTimestamp(embed.timestamp === true ? new Date() : new Date(embed.timestamp));
        if (embed.author) e.setAuthor({ name: embed.author.name, iconURL: embed.author.icon_url, url: embed.author.url });
        if (embed.footer) e.setFooter({ text: embed.footer.text, iconURL: embed.footer.icon_url });
        if (embed.thumbnail?.url) e.setThumbnail(embed.thumbnail.url);
        if (embed.image?.url) e.setImage(embed.image.url);
        if (Array.isArray(embed.fields)) e.addFields(embed.fields.map(f => ({ name: f.name, value: f.value, inline: !!f.inline })));
        return e;
      });
    }
    if (Array.isArray(data.attachments) && data.attachments.length) payload.files = data.attachments;

    await targetChannel.send(payload);
  } catch (err) {
    await message.channel.send({ embeds: [createErrorEmbed("Erro ao enviar embed", err.message)] });
  }
});

// Parse de cor flexível - hex (#RGB/#RRGGBB), int, ou nome pt/EN básico.
const COLOR_NAMES = {
  red: 0xED4245, vermelho: 0xED4245,
  green: 0x57F287, verde: 0x57F287,
  blue: 0x3498DB, azul: 0x3498DB,
  yellow: 0xFEE75C, amarelo: 0xFEE75C,
  orange: 0xE67E22, laranja: 0xE67E22,
  purple: 0x9B59B6, roxo: 0x9B59B6,
  pink: 0xE91E63, rosa: 0xE91E63,
  white: 0xFFFFFF, branco: 0xFFFFFF,
  black: 0x000000, preto: 0x000000,
  blurple: 0x5865F2, padrao: 0x5865F2, default: 0x5865F2,
};

function parseColor(raw) {
  if (!raw) return 0x5865F2;
  const s = raw.trim().toLowerCase();
  if (COLOR_NAMES[s] !== undefined) return COLOR_NAMES[s];
  if (/^#?[0-9a-f]{6}$/i.test(s)) return parseInt(s.replace('#', ''), 16);
  if (/^#?[0-9a-f]{3}$/i.test(s)) {
    const h = s.replace('#', '');
    return parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return 0x5865F2;
}

// Handler do submit do modal - chamado pelo router em interactions.js
export async function handleEscreverModalSubmit(interaction, client) {
  try {
    const conteudo = interaction.fields.getTextInputValue('conteudo')?.trim();
    const titulo = interaction.fields.getTextInputValue('titulo')?.trim();
    const descricao = interaction.fields.getTextInputValue('descricao')?.trim();
    const corRaw = interaction.fields.getTextInputValue('cor')?.trim();
    const imagem = interaction.fields.getTextInputValue('imagem')?.trim();

    // Validação: pelo menos 1 campo preenchido
    if (!conteudo && !titulo && !descricao && !imagem) {
      return interaction.reply({
        embeds: [createErrorEmbed('Nada preenchido', 'Preencha pelo menos um dos campos (conteúdo, título, descrição ou imagem).')],
        ephemeral: true,
      });
    }

    const channelId = interaction.customId.split(':')[1] || interaction.channelId;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      return interaction.reply({ embeds: [createErrorEmbed('Canal inválido', `Não consegui enviar em <#${channelId}>.`)], ephemeral: true });
    }

    // Monta payload: content (texto puro) + embed (se tiver campos visuais)
    const payload = {};
    if (conteudo) payload.content = conteudo.slice(0, 2000);

    if (titulo || descricao || imagem) {
      const embed = new EmbedBuilder().setColor(parseColor(corRaw));
      if (titulo) embed.setTitle(titulo.slice(0, 256));
      if (descricao) embed.setDescription(descricao.slice(0, 4096));
      if (imagem) embed.setImage(imagem);
      payload.embeds = [embed];
    }

    await interaction.deferReply({ ephemeral: true });
    await channel.send(payload);
    await interaction.editReply({ embeds: [createSuccessEmbed('Enviado', `Mensagem publicada em <#${channelId}>.`)] });
  } catch (err) {
    console.error('[Escrever Modal Error]', err);
    const payload = { embeds: [createErrorEmbed('Erro ao enviar', err.message)], ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

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
        content: `Prioridade ajustada, consulte a sua posição na fila de espera no nome do seu ticket\nLembrando que conforme a sua interação no servidor, seja por calls ou mensagens, sua prioridade será maior.\n\nPriority adjusted, check your position in the waiting queue in your ticket name\nRemember that according to your interaction on the server, whether by calls or messages, your priority will be higher.`
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

// A description do embed morre em 4096 caracteres; abaixo disso a página quebra e o discord.js
// recusa o embed inteiro antes de enviar. Nada é cortado - o que não cabe vira a página seguinte.
const BLINDAGENS_POR_PAGINA = 10;
const LIMITE_DA_PAGINA = 3600;

/** Quebra as linhas em páginas que cabem no embed. Nenhuma linha é descartada. */
function paginarBlindagens(linhas) {
  if (!linhas.length) return [];

  const paginas = [];
  let atual = [];
  let tamanho = 0;

  for (const linha of linhas) {
    const estouraTamanho = tamanho + linha.length + 1 > LIMITE_DA_PAGINA;

    if (atual.length && (atual.length >= BLINDAGENS_POR_PAGINA || estouraTamanho)) {
      paginas.push(atual);
      atual = [];
      tamanho = 0;
    }

    atual.push(linha);
    tamanho += linha.length + 1;
  }

  if (atual.length) paginas.push(atual);

  return paginas;
}

/** Motivo é texto livre digitado pelo membro - corta para a linha não dominar a página. */
function resumirMotivo(reason) {
  const texto = String(reason || '').trim() || 'sem motivo registrado';
  return texto.length > 120 ? `${texto.slice(0, 119)}…` : texto;
}

// .blindagens - quem está protegido da inativação e quais pedidos aguardam a staff
export const handleBlindagens = adminOnly(async (message, args, client) => {
  // A semana que a rotina de inativação avalia (a que já fechou)
  const semanaAvaliada = getLastWednesdayReference();

  const [aprovadas, pendentes] = await Promise.all([
    getBlindagensAprovadas(),
    getBlindagensPendentes()
  ]);

  const permanentes = [...aprovadas.filter(ehPermanente)]
    .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));

  const temporarias = aprovadas.filter((b) => !ehPermanente(b));

  // Vigente = ainda não expirou. Não dá para usar cobreSemana contra a semana avaliada aqui: uma
  // blindagem pedida agora nasce com week_start na semana **em curso**, que é posterior à avaliada,
  // e cairia fora da lista mesmo estando aprovada e valendo.
  const vigentes = [...temporarias.filter((b) => fimDaBlindagem(b) > semanaAvaliada)]
    .sort((a, b) => fimDaBlindagem(a).localeCompare(fimDaBlindagem(b)));

  const expiradas = temporarias.length - vigentes.length;

  const linhasPermanentes = permanentes.map(
    (b) => `<@${b.discord_id}>\n> ${resumirMotivo(b.reason)}`
  );

  const linhasVigentes = vigentes.map((b) => {
    // Fim é exclusivo: a última semana coberta começa 7 dias antes dele
    const [ano, mes, dia] = fimDaBlindagem(b).split('-').map(Number);
    const ultimaSemana = new Date(ano, mes - 1, dia - 7);

    const cobreAgora = cobreSemana(b, semanaAvaliada);
    const quando = cobreAgora
      ? `✅ cobre a semana avaliada`
      : `🔜 começa em ${formatDateBR(b.week_start)}`;

    return `<@${b.discord_id}> - **${b.weeks}** semana(s), até ${ultimaSemana.toLocaleDateString('pt-BR')} • ${quando}\n> ${resumirMotivo(b.reason)}`;
  });

  const linhasPendentes = [...pendentes]
    .sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)))
    .map((b) => `<@${b.discord_id}> - pediu **${b.weeks}** semana(s), a partir de ${formatDateBR(b.week_start)}\n> ${resumirMotivo(b.reason)}`);

  const abas = {
    perm: {
      rotulo: 'Permanentes',
      titulo: '♾️ Blindagens permanentes',
      cor: 0x5865f2,
      total: permanentes.length,
      paginas: paginarBlindagens(linhasPermanentes),
      vazio: 'Ninguém com blindagem permanente.',
      rodape: 'Blindagem permanente é linha manual no banco, com weeks nulo'
    },
    temp: {
      rotulo: 'Temporárias',
      titulo: '⏳ Blindagens temporárias vigentes',
      cor: 0xfaa61a,
      total: vigentes.length,
      paginas: paginarBlindagens(linhasVigentes),
      vazio: 'Nenhuma blindagem temporária em vigor.',
      rodape: expiradas > 0
        ? `${expiradas} temporária(s) já expirada(s) fora da lista`
        : 'Nenhuma temporária expirada no histórico'
    },
    pend: {
      rotulo: 'Pendentes',
      titulo: '📨 Pedidos aguardando decisão',
      cor: 0xed4245,
      total: pendentes.length,
      paginas: paginarBlindagens(linhasPendentes),
      vazio: 'Nenhum pedido esperando decisão.',
      rodape: 'Aprove ou recuse pelos botões no canal da staff'
    }
  };

  let aba = 'perm';
  let pagina = 0;

  function montarEmbed() {
    const atual = abas[aba];
    const totalPaginas = Math.max(1, atual.paginas.length);
    const conteudo = atual.paginas[pagina]?.join('\n\n') ?? atual.vazio;

    return new EmbedBuilder()
      .setColor(atual.cor)
      .setTitle(`🛡️ ${atual.titulo}`)
      .setDescription(
        `Semana avaliada: **${formatDateBR(semanaAvaliada)}** • ` +
        `officer e admin não precisam de blindagem\n\n${conteudo}`
      )
      .setFooter({
        text: `${atual.total} no total • pagina ${pagina + 1}/${totalPaginas} • ${atual.rodape}`
      })
      .setTimestamp();
  }

  function montarComponentes() {
    const linhas = [
      new ActionRowBuilder().addComponents(
        Object.entries(abas).map(([id, dados]) =>
          new ButtonBuilder()
            .setCustomId(`blind_${id}`)
            .setLabel(`${dados.rotulo} (${dados.total})`)
            .setStyle(aba === id ? ButtonStyle.Primary : ButtonStyle.Secondary)
        )
      )
    ];

    if (abas[aba].paginas.length > 1) {
      linhas.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('blind_prev')
            .setLabel('⬅️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina === 0),
          new ButtonBuilder()
            .setCustomId('blind_next')
            .setLabel('➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina >= abas[aba].paginas.length - 1)
        )
      );
    }

    return linhas;
  }

  // Menção dentro de embed não notifica, mas o allowedMentions evita ping se o texto vazar
  const sent = await message.reply({
    embeds: [montarEmbed()],
    components: montarComponentes(),
    allowedMentions: { parse: [] }
  });

  const collector = sent.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 180000
  });

  collector.on('collect', async (interaction) => {
    try {
      if (interaction.customId === 'blind_prev') {
        pagina = Math.max(0, pagina - 1);
      } else if (interaction.customId === 'blind_next') {
        pagina = Math.min(abas[aba].paginas.length - 1, pagina + 1);
      } else {
        aba = interaction.customId.replace('blind_', '');
        pagina = 0;
      }

      await interaction.update({
        embeds: [montarEmbed()],
        components: montarComponentes()
      });
    } catch (err) {
      console.error('[BLINDAGENS] Erro no botao:', err);
    }
  });

  collector.on('end', async () => {
    await sent.edit({ components: [] }).catch(() => {});
  });
});

// Data em que os guild points passaram a existir. Serve de piso pra média semanal
// do .scan: dividir pelo tempo total de guilda achataria quem é membro antigo.
const GUILD_POINTS_DESDE = new Date(2025, 11, 3); // 03/12/2025 (mês é 0-indexado)

// .scan <@usuario/id> - visão de staff sobre um membro, em abas
export const handleScan = adminOnly(async (message, args, client) => {
  let loadingMsg = null;

  try {
    // Slash entrega o usuário tipado; no prefixo cai na menção ou no ID solto
    let targetUserId = null;

    if (message.interaction) {
      targetUserId = message.interaction.options.getUser('usuario')?.id ?? null;
    } else {
      const mention = message.content.match(/<@!?(\d+)>/);
      if (mention) targetUserId = mention[1];
      else if (args[0]?.match(/^\d+$/)) targetUserId = args[0];
    }

    const escaneandoSiMesmo = !targetUserId;
    if (!targetUserId) targetUserId = message.author.id;

    const user = await getUserByDiscordId(targetUserId);

    if (!user || !user.brawlhalla_id) {
      return await message.reply({
        embeds: [createErrorEmbed(
          'Sem Cadastro',
          escaneandoSiMesmo
            ? 'Você não tem Brawlhalla ID registrado.'
            : 'Este usuário não tem Brawlhalla ID registrado.'
        )]
      });
    }

    loadingMsg = await message.reply({
      embeds: [createLoadingEmbed('Escaneando...', `${EMOJIS.loading} Juntando os dados de <@${targetUserId}>.`)]
    });

    await loadAliases();

    // Dois ids de propósito, porque as duas metades do scan medem coisas diferentes:
    //
    // - `brawlhallaId` é o de `users`, a conta que aparece na guilda do jogo. Histórico,
    //   justificativas e guild points (contribuição) são registrados por ele.
    // - `idJogo` é a principal resolvida pelo `alt_ids`. É por ele que o cron do site grava os
    //   campos de partidas e é o que o `.games` lê, então os jogos saem daí — senão os dois
    //   comandos mostram números diferentes para a mesma pessoa.
    //
    // Antes o scan usava o id cadastrado para tudo, mas as estatísticas vinham do
    // `fetchPlayerStats`, que resolve alt por dentro: a leitura atual era de uma conta e a base
    // semanal de outra, e a subtração misturava as duas.
    const brawlhallaId = String(user.brawlhalla_id);
    const idJogo = resolveBrawlhallaId(brawlhallaId);

    const weekStart = getMissionWeekStartDateTime();
    const prevWeekStart = getPreviousMissionWeekStart();

    // `semana*` (id cadastrado) é a base de guild points; `jogos*` (id resolvido) é a de partidas.
    // Quando não há alt os dois ids são o mesmo e as duas leituras coincidem.
    const [history, justificativas, semanaAtual, semanaPassada, jogosSemanaAtual, jogosSemanaPassada, warns] = await Promise.all([
      getMembershipHistory(brawlhallaId),
      getMemberJustifications(brawlhallaId),
      getWeeklyInitial(brawlhallaId, weekStart),
      getWeeklyInitial(brawlhallaId, prevWeekStart),
      getWeeklyInitial(idJogo, weekStart),
      getWeeklyInitial(idJogo, prevWeekStart),
      getUserWarnings(targetUserId)
    ]);

    // API externa não pode derrubar o comando: sem ela as abas mostram o que dá
    // Resolve alt igual ao `.games` - as partidas descrevem a conta principal
    const stats = await fetchPlayerStats(idJogo).catch((err) => {
      console.warn(`[SCAN] Stats indisponiveis para ${idJogo}:`, err.message);
      return null;
    });

    const guildStats = await fetchPlayerGuildStatsNewAPI(brawlhallaId).catch((err) => {
      console.warn(`[SCAN] Guild points indisponiveis para ${brawlhallaId}:`, err.message);
      return null;
    });

    // ─── Cálculos ──────────────────────────────────────────────────────────────
    const entradas = history.filter((h) => h.action === 'entrou');
    const saidas = history.filter((h) => h.action === 'saiu');
    const promocoes = history.filter((h) => h.action === 'promovido');
    const rebaixamentos = history.filter((h) => h.action === 'rebaixado');

    // history vem do mais recente para o mais antigo
    const ultimaEntrada = entradas[0] ?? null;
    const primeiraEntrada = entradas[entradas.length - 1] ?? null;
    const ultimaSaida = saidas[0] ?? null;

    // Tempo de casa (só exibição no Geral) - conta desde a entrada, sem piso
    let semanasNaGuilda = null;
    if (ultimaEntrada) {
      const dias = (Date.now() - new Date(ultimaEntrada.occurred_at).getTime()) / 86400000;
      semanasNaGuilda = Math.max(1, Math.floor(dias / 7));
    }

    // Divisor da média: guild points só passaram a existir em 03/12/2025, então semana
    // anterior a isso não conta. Quem entrou depois conta a partir da própria entrada.
    const entradaMs = ultimaEntrada ? new Date(ultimaEntrada.occurred_at).getTime() : 0;
    const inicioContagem = Math.max(entradaMs, GUILD_POINTS_DESDE.getTime());

    const divisorSemanas = Math.max(1, Math.floor((Date.now() - inicioContagem) / (7 * 86400000)));
    const baseDivisor = inicioContagem === GUILD_POINTS_DESDE.getTime()
      ? 'semanas desde 03/12/2025 (inicio dos guild points)'
      : 'semanas desde a entrada na guilda';

    const pontosTotais = guildStats?.personal_points ?? null;

    // guild_points em player_weekly_info é a linha de base do início da semana.
    // O ganho da semana passada é a diferença entre a base desta semana e a da anterior.
    let pontosSemanaPassada = null;
    if (semanaAtual?.guild_points > 0 && semanaPassada?.guild_points > 0) {
      pontosSemanaPassada = semanaAtual.guild_points - semanaPassada.guild_points;
    }

    // Contribuição da semana corrente: total atual menos a base gravada na quinta.
    // Base 0 só é legítima para quem entrou na guilda durante esta semana; para quem já estava
    // aqui ela significa base não registrada, e subtrair de 0 leria o acumulado inteiro como ganho.
    const inicioSemanaEmSegundos = Math.floor(new Date(String(weekStart).replace(' ', 'T')).getTime() / 1000);
    const entrouNestaSemana = Number(guildStats?.join_date || 0) > 0
      && Number(guildStats.join_date) >= inicioSemanaEmSegundos;

    let pontosSemanaAtual = null;
    let motivoSemanaAtual = 'Sem base gravada';

    if (pontosTotais == null) {
      motivoSemanaAtual = 'Indisponivel (API fora do ar)';
    } else if (semanaAtual) {
      const base = semanaAtual.guild_points;
      const baseZeradaIndevida = Number(base) === 0 && pontosTotais > 0 && !entrouNestaSemana;

      if (base === null || base === undefined || baseZeradaIndevida) {
        motivoSemanaAtual = 'Base nao registrada';
      } else {
        pontosSemanaAtual = Math.max(0, pontosTotais - Number(base));
      }
    }

    const mediaSemanal = pontosTotais != null ? Math.round(pontosTotais / divisorSemanas) : null;

    const jogosAtual = stats && jogosSemanaAtual ? calculateGames(stats, stats.ranked, jogosSemanaAtual) : null;

    let jogosPassada = null;
    if (jogosSemanaPassada && jogosSemanaPassada.final_games > 0) {
      jogosPassada = calculateGamesFromClosedWeek(jogosSemanaPassada);
    }

    const nomeJogo = stats?.name ?? ultimaEntrada?.nome ?? user.username ?? 'Desconhecido';

    // ─── Abas ──────────────────────────────────────────────────────────────────
    const JUST_POR_PAGINA = 5;
    const totalPaginasJust = Math.max(1, Math.ceil(justificativas.length / JUST_POR_PAGINA));

    const WARN_POR_PAGINA = 5;
    const totalPaginasWarn = Math.max(1, Math.ceil(warns.length / WARN_POR_PAGINA));

    let aba = 'geral';
    let paginaJust = 0;
    let paginaWarn = 0;

    function embedGeral() {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🔎 Scan - ${nomeJogo}`)
        .setDescription(`<@${targetUserId}> • \`${brawlhallaId}\``)
        .addFields(
          { name: '🏷️ Cargo no bot', value: `\`${user.role ?? '-'}\``, inline: true },
          { name: '📌 Status', value: user.active ? '`ativo`' : '`inativo`', inline: true },
          { name: '🎖️ Rank na guilda', value: `\`${guildStats?.rank ?? ultimaEntrada?.rank ?? '-'}\``, inline: true }
        );

      if (ultimaEntrada) {
        embed.addFields({
          name: '📥 Entrou na guilda',
          value: `${formatCreatedAtBR(ultimaEntrada.occurred_at)}${semanasNaGuilda ? ` - ha ~${semanasNaGuilda} semana(s)` : ''}`,
          inline: false
        });

        if (entradas.length > 1 && primeiraEntrada) {
          embed.addFields({
            name: '↩️ Primeira entrada',
            value: `${formatCreatedAtBR(primeiraEntrada.occurred_at)} - ${entradas.length} entradas no total`,
            inline: false
          });
        }
      } else {
        embed.addFields({
          name: '📥 Entrou na guilda',
          value: 'Sem registro em `guild_membership_history`',
          inline: false
        });
      }

      embed.addFields({
        name: '🚪 Já saiu da guilda',
        value: saidas.length
          ? `**${saidas.length}x** - a ultima em ${formatCreatedAtBR(ultimaSaida.occurred_at)}`
          : 'Nunca saiu',
        inline: false
      });

      if (promocoes.length || rebaixamentos.length) {
        embed.addFields({
          name: '📊 Movimentação',
          value: `⬆️ ${promocoes.length} promoção(ões) • ⬇️ ${rebaixamentos.length} rebaixamento(s)`,
          inline: false
        });
      }

      return embed;
    }

    function embedJogos() {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`🎮 Jogos - ${nomeJogo}`);

      if (jogosAtual) {
        embed.addFields({
          name: `📅 Esta semana (desde ${formatDateBR(weekStart)})`,
          value:
            `Total: \`${jogosAtual.totalGames}\` • Casuais: \`${jogosAtual.casualGames}\`\n` +
            `1v1: \`${jogosAtual.games1v1}\` • 2v2: \`${jogosAtual.games2v2}\` • 3v3: \`${jogosAtual.games3v3}\``,
          inline: false
        });
      } else {
        embed.addFields({
          name: '📅 Esta semana',
          value: stats ? 'Sem registro semanal para esta semana.' : 'Estatisticas indisponiveis (API fora do ar).',
          inline: false
        });
      }

      if (jogosPassada) {
        embed.addFields({
          name: `🕓 Semana passada (${formatDateBR(prevWeekStart)})`,
          value:
            `Total: \`${jogosPassada.totalGames}\` • Casuais: \`${jogosPassada.casualGames}\`\n` +
            `1v1: \`${jogosPassada.games1v1}\` • 2v2: \`${jogosPassada.games2v2}\` • 3v3: \`${jogosPassada.games3v3}\``,
          inline: false
        });
      } else {
        embed.addFields({
          name: '🕓 Semana passada',
          value: 'Sem fechamento gravado para a semana passada.',
          inline: false
        });
      }

      return embed;
    }

    function embedPontos() {
      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`⭐ Guild Points - ${nomeJogo}`)
        .addFields(
          {
            name: '🏆 Total acumulado',
            value: pontosTotais != null ? `\`${pontosTotais.toLocaleString('pt-BR')}\`` : 'Indisponivel (API fora do ar)',
            inline: true
          },
          {
            name: '📅 Esta semana',
            value: pontosSemanaAtual != null ? `\`${pontosSemanaAtual.toLocaleString('pt-BR')}\`` : motivoSemanaAtual,
            inline: true
          },
          {
            name: '🕓 Semana passada',
            value: pontosSemanaPassada != null ? `\`${pontosSemanaPassada.toLocaleString('pt-BR')}\`` : 'Sem base gravada',
            inline: true
          },
          {
            name: '📈 Média por semana',
            value: mediaSemanal != null ? `\`${mediaSemanal.toLocaleString('pt-BR')}\`` : '-',
            inline: true
          }
        );

      if (mediaSemanal != null) {
        embed.setFooter({ text: `Media sobre ${divisorSemanas} ${baseDivisor}` });
      }

      return embed;
    }

    function embedJustificativas() {
      if (!justificativas.length) {
        return new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle(`📋 Justificativas - ${nomeJogo}`)
          .setDescription('Nunca foi marcado como inativo.');
      }

      const comNota = justificativas.filter((j) => j.note).length;
      const inicio = paginaJust * JUST_POR_PAGINA;
      const itens = justificativas.slice(inicio, inicio + JUST_POR_PAGINA);

      const descricao = itens
        .map((item, i) => {
          const quando = item.created_at ? formatDateBR(item.created_at) : '-';
          const semana = item.week_reference ? formatDateBR(item.week_reference) : '-';
          const texto = item.note || '_ainda sem justificativa nessa semana_';
          return `**${inicio + i + 1}.** 🗓️ semana de ${semana} • 🕒 ${quando}\n${texto}`;
        })
        .join('\n\n');

      return new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`📋 Justificativas - ${nomeJogo}`)
        .setDescription(descricao)
        .setFooter({
          text: `${comNota} justificada(s) de ${justificativas.length} semana(s) inativo • pagina ${paginaJust + 1}/${totalPaginasJust}`
        });
    }

    function embedWarns() {
      if (!warns.length) {
        return new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle(`⚠️ Warns - ${nomeJogo}`)
          .setDescription('Nenhum aviso ativo.');
      }

      const temporarios = warns.filter((w) => w.expires_at).length;
      const inicio = paginaWarn * WARN_POR_PAGINA;
      const itens = warns.slice(inicio, inicio + WARN_POR_PAGINA);

      const descricao = itens
        .map((w, i) => {
          const quando = w.created_at ? formatCreatedAtBR(w.created_at) : '-';
          const moderador = w.moderator_id ? ` • por <@${w.moderator_id}>` : '';
          const expira = w.expires_at
            ? `\n> ⏳ expira <t:${Math.floor(new Date(w.expires_at).getTime() / 1000)}:R>`
            : '';

          return `**${inicio + i + 1}.** 🕒 ${quando}${moderador}\n> ${w.reason || 'Sem motivo especificado'}${expira}`;
        })
        .join('\n\n');

      return new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`⚠️ Warns - ${nomeJogo}`)
        .setDescription(descricao)
        .setFooter({
          text: `${warns.length} aviso(s) • ${temporarios} temporario(s) • pagina ${paginaWarn + 1}/${totalPaginasWarn}`
        });
    }

    function montarEmbed() {
      if (aba === 'jogos') return embedJogos();
      if (aba === 'pontos') return embedPontos();
      if (aba === 'just') return embedJustificativas();
      if (aba === 'warns') return embedWarns();
      return embedGeral();
    }

    function montarComponentes() {
      const abas = [
        { id: 'geral', label: 'Geral' },
        { id: 'jogos', label: 'Jogos' },
        { id: 'pontos', label: 'Guild Points' },
        { id: 'just', label: `Justificativas${justificativas.length ? ` (${justificativas.length})` : ''}` },
        { id: 'warns', label: `Warns${warns.length ? ` (${warns.length})` : ''}` }
      ];

      const linhas = [
        new ActionRowBuilder().addComponents(
          abas.map((item) =>
            new ButtonBuilder()
              .setCustomId(`scan_${item.id}`)
              .setLabel(item.label)
              .setStyle(aba === item.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
          )
        )
      ];

      // Setas só aparecem nas abas paginadas, e só se houver mais de uma página
      if (aba === 'just' && totalPaginasJust > 1) {
        linhas.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('scan_j_prev')
              .setLabel('⬅️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(paginaJust === 0),
            new ButtonBuilder()
              .setCustomId('scan_j_next')
              .setLabel('➡️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(paginaJust >= totalPaginasJust - 1)
          )
        );
      }

      if (aba === 'warns' && totalPaginasWarn > 1) {
        linhas.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('scan_w_prev')
              .setLabel('⬅️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(paginaWarn === 0),
            new ButtonBuilder()
              .setCustomId('scan_w_next')
              .setLabel('➡️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(paginaWarn >= totalPaginasWarn - 1)
          )
        );
      }

      return linhas;
    }

    const sent = await sendCleanMessage(loadingMsg, {
      embeds: [montarEmbed()],
      components: montarComponentes()
    });

    const collector = sent.createMessageComponentCollector({
      filter: (i) => i.user.id === message.author.id,
      time: 180000
    });

    collector.on('collect', async (interaction) => {
      try {
        if (interaction.customId === 'scan_j_prev') paginaJust = Math.max(0, paginaJust - 1);
        else if (interaction.customId === 'scan_j_next') paginaJust = Math.min(totalPaginasJust - 1, paginaJust + 1);
        else if (interaction.customId === 'scan_w_prev') paginaWarn = Math.max(0, paginaWarn - 1);
        else if (interaction.customId === 'scan_w_next') paginaWarn = Math.min(totalPaginasWarn - 1, paginaWarn + 1);
        else aba = interaction.customId.replace('scan_', '');

        await interaction.update({
          embeds: [montarEmbed()],
          components: montarComponentes()
        });
      } catch (err) {
        console.error('[SCAN] Erro no botao:', err);
      }
    });

    collector.on('end', async () => {
      await sent.edit({ components: [] }).catch(() => {});
    });

  } catch (err) {
    console.error('[SCAN]', err);
    const errorEmbed = createErrorEmbed('Erro no scan', err.message);

    if (loadingMsg) await sendCleanMessage(loadingMsg, { embeds: [errorEmbed] });
    else await message.reply({ embeds: [errorEmbed] });
  }
});