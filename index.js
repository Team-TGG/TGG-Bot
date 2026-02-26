/**
 * TGG Bot: Discord bot with prefix commands (.) for role sync and guild management.
 * Admin-only commands (users in ALLOWED_USER_IDS can run these).
 * Commands: .sync-guild-roles, .sync-elo-roles, .guild-activity, .movimentacao, .help
 */

import 'dotenv/config';
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder } from 'discord.js';
import { getUsers, getUsersWithElo, addInactivePlayer, removeInactivePlayer, getInactivePlayers } from './src/db.js';
import { createClient, runSync, runEloSync } from './src/discord.js';
import { runAndPostGuildActivity } from './src/guildActivity.js';
import { fetchMovimentacao, buildMovimentacaoEmbeds, getDefaultDateRange, isValidDate, formatMovimentacaoAsText } from './src/movimentacao.js';
import { syncNicknames, updateMemberNicknameDiscordPortion, parseNickname, buildNickname, fetchBrawlhallaClanData, loadClanCache } from './src/nicknameSync.js';
import { loadCustomNicknames } from './src/customNicknames.js';
import { discord as discordConfig, ALLOWED_USER_IDS, inactivePlayers as inactivePlayersConfig } from './config/index.js';
import { getUserByDiscordId } from './src/db.js';

async function main() {
  if (!discordConfig.token || !discordConfig.guildId) {
    console.error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env');
    process.exit(1);
  }

  const client = createClient();
  const PREFIX = '.';

  const COMMAND_ALIASES = {
    'sync-guild': 'sync-guild-roles',
    'sync-guild-roles': 'sync-guild-roles',
    'sync-roles': 'sync-guild-roles',
    'sync-elo': 'sync-elo-roles',
    'sync-elo-roles': 'sync-elo-roles',
    'sync': 'sync',
    'guild-activity': 'guild-activity',
    'activity': 'guild-activity',
    'mov': 'movimentacao',
    'movimentacao': 'movimentacao',
    'sync-nick': 'sync-nicknames',
    'sync-nicknames': 'sync-nicknames',
    'refresh-cache': 'refresh-clan-cache',
    'refresh-clan-cache': 'refresh-clan-cache',
    'help': 'help',
    'active': 'active',
    'inac': 'inac',
    'unac': 'unac',
    'inac-list': 'inac-list',
    'inac-test': 'inac-test',
  };

  // Emoji constants (custom/server emojis and unicode)
  const EMOJIS = {
    arrowLeft: '<:arrowleft:1475806697162539059>',
    arrowRight: '<:arrowright:1475806826833383456>',
    check: '<:check:1475806856722120838>',
    checkbox: '<:checkbox:1475806904482660476>',
    loading: '<a:loading:1475806256366358633>',
    square: '<:square:1475807057830744074>',
    symboldash: '<:symboldash:1475807293323870238>',
    greaterthan: '<:greaterthan:1475807008010534942>',
    xis2: '<:xis2:1475807173291278369>',
    xis: '<:xis:1475807109554896966>',
    clipboard: '<:clipboard:1475806180621287527>',
    lessthan: '<:lessthan:1475806956437635082>',
    baixo: '<:baixo:1475807866714718239>',
    cima: '<:cima:1475807892782317578>',
    clock: '<:clock:1475829939122212874>',
    success: '<:check:1475806856722120838>',
  };

  client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
  });

  function isAdmin(userId) {
    return ALLOWED_USER_IDS.includes(userId);
  }

  function createErrorEmbed(title, message) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`${EMOJIS.xis} ${title}`)
      .setDescription(message)
      .setTimestamp();
  }

  function createSuccessEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`${EMOJIS.success} ${title}`)
      .setDescription(description)
      .setTimestamp();
  }

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const rawCommand = args[0]?.toLowerCase();
    const command = COMMAND_ALIASES[rawCommand] || rawCommand;

    // Commands that don't require admin access
    const publicCommands = ['active'];
    
    // Admin check for admin-only commands
    if (!publicCommands.includes(command) && !isAdmin(message.author.id)) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar estes comandos.')] });
    }

    try {
      if (command === 'help') {
        const page1 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.clipboard} Sincronização`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .sync`, value: 'Sincronização completa (ranks + ELO)', inline: false },
            { name: `${EMOJIS.arrowRight} .sync-guild`, value: 'Sincronizar ranks da guild', inline: false },
            { name: `${EMOJIS.arrowRight} .sync-elo`, value: 'Sincronizar roles de ELO', inline: false },
            { name: `${EMOJIS.arrowRight} .sync-nick`, value: 'Sincronizar apelidos Brawlhalla', inline: false },
            { name: `${EMOJIS.arrowRight} .refresh-cache`, value: 'Atualizar cache do clan', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();
        
        const page2 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.clipboard} Informações`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .guild-activity`, value: 'Sincronizar atividade da guild', inline: false },
            { name: `${EMOJIS.arrowRight} .mov [data-início] [data-fim]`, value: 'Buscar movimentação (YYYY-MM-DD)', inline: false },
            { name: `${EMOJIS.arrowRight} .help`, value: 'Mostrar esta mensagem', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page3 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.clipboard} Inativos`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .inac [@user]`, value: 'Marcar jogador como inativo nesta semana', inline: false },
            { name: `${EMOJIS.arrowRight} .active [@user]`, value: 'Remover jogador da lista de inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .unac [@user]`, value: 'Forçar remoção de jogador da lista de inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .inac-list`, value: 'Listar todos os jogadores inativos desta semana', inline: false },
            { name: `${EMOJIS.arrowRight} .inac-test`, value: 'Enviar mensagem de teste com usuários inativos', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('help_menu')
          .setPlaceholder('Escolha uma categoria...')
          .addOptions(
            { label: 'Sincronização', value: 'sync', emoji: EMOJIS.arrowRight, description: 'Comandos de sincronização' },
            { label: 'Informações', value: 'info', emoji: EMOJIS.clipboard, description: 'Comandos de informação' },
            { label: 'Inativos', value: 'inac', emoji: EMOJIS.xis, description: 'Comandos de inatividade' }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const helpMsg = await message.reply({ embeds: [page1], components: [row] });

        // Create a collector for the select menu
        const collector = helpMsg.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== message.author.id) {
            return interaction.reply({ content: 'Você não pode usar este menu', ephemeral: true });
          }

          if (interaction.customId === 'help_menu') {
            const selected = interaction.values[0];
            let embedToShow = page1;
            if (selected === 'info') embedToShow = page2;
            if (selected === 'inac') embedToShow = page3;
            await interaction.update({ embeds: [embedToShow], components: [row] });
          }
        });

        collector.on('end', () => {
          helpMsg.delete().catch(() => {});
        });
      }

      // The rest of the existing command handlers (sync, sync-guild-roles, sync-elo-roles, guild-activity,
      // movimentacao, sync-nicknames, refresh-clan-cache) are implemented below — reuse the existing
      // functions imported at top (getUsers, runSync, runEloSync, runAndPostGuildActivity, etc.).

      // .sync-guild-roles
      if (command === 'sync-guild-roles') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Sincronizando ranks...')] });
        try {
          const users = await getUsers();
          const result = await runSync(client, users);
          const resultEmbed = createSuccessEmbed('Ranks Sincronizados', `${EMOJIS.check} ${result.synced} | ${EMOJIS.checkbox} ${result.skipped} | ${EMOJIS.xis} ${result.errors}`);
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro de Sincronização', err.message)] });
        }
      }

      // .sync-elo-roles
      if (command === 'sync-elo-roles') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Sincronizando ELO...')] });
        try {
          const usersWithElo = await getUsersWithElo();
          const result = await runEloSync(client, usersWithElo);
          const resultEmbed = createSuccessEmbed('ELO Sincronizado', `${EMOJIS.check} ${result.synced} | ${EMOJIS.checkbox} ${result.skipped} | ${EMOJIS.xis} ${result.errors}`);
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro de Sincronização', err.message)] });
        }
      }

      // .guild-activity
      if (command === 'guild-activity') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Sincronizando...`).setDescription('Buscando atividade da guild...')] });
        try {
          const result = await runAndPostGuildActivity(client);
          if (result.ok) {
            const summary = result.summary || {};
            const resultEmbed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle(`${EMOJIS.check} Atividade Sincronizada`)
              .addFields(
                { name: `${EMOJIS.cima} Entradas`, value: `${summary.entrou ?? 0}`, inline: true },
                { name: `${EMOJIS.baixo} Sa\u00eddas`, value: `${summary.saiu ?? 0}`, inline: true },
                { name: `${EMOJIS.arrowRight} Saldo`, value: `${summary.saldo_liquido ?? 0}`, inline: true }
              )
              .setTimestamp();
            await loading.edit({ embeds: [resultEmbed] });
          } else {
            await loading.edit({ embeds: [createErrorEmbed('Erro na Sincronização', result.error)] });
          }
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro na Sincronização', err.message)] });
        }
      }

      // .movimentacao
      if (command === 'movimentacao' || command === 'mov') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Buscando...`).setDescription('Carregando dados de movimentação...')] });
        try {
          let startDate, endDate, queryType = 'range';
          
          if (args.length >= 3) {
            // Two dates provided: date range
            startDate = args[1];
            endDate = args[2];
            if (!isValidDate(startDate) || !isValidDate(endDate)) {
              return loading.edit({ embeds: [createErrorEmbed('Data Inválida', 'Formato: YYYY-MM-DD')] });
            }
            queryType = 'range';
          } else if (args.length === 2) {
            // One date provided: single day
            startDate = args[1];
            if (!isValidDate(startDate)) {
              return loading.edit({ embeds: [createErrorEmbed('Data Inválida', 'Formato: YYYY-MM-DD')] });
            }
            endDate = startDate; // Same day
            queryType = 'day';
          } else {
            // No dates provided: default to last 7 days
            const range = getDefaultDateRange();
            startDate = range.startDate;
            endDate = range.endDate;
            queryType = 'range';
          }
          
          const data = await fetchMovimentacao({ date: queryType === 'day' ? startDate : null, startDate: queryType === 'range' ? startDate : null, endDate: queryType === 'range' ? endDate : null });
          const result = buildMovimentacaoEmbeds(data.data || [], startDate, endDate);
          
          if (result.needsFile) {
            // Send data as text file if embeds would be too large
            const textContent = formatMovimentacaoAsText(result.json);
            const attachment = new AttachmentBuilder(Buffer.from(textContent), {
              name: `movimentacao_${startDate}_${endDate}.txt`,
            });
            const dateDisplay = startDate === endDate ? startDate : `${startDate} a ${endDate}`;
            await loading.edit({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xfaa61a)
                  .setTitle(`${EMOJIS.ponto} Guild Movimentação (Arquivo)`)
                  .setDescription(`Dados de ${dateDisplay}\n\nOs dados foram salvos em arquivo de texto pois ultrapassaram o limite de tamanho.`)
                  .addFields([
                    { name: 'Entradas', value: String(result.json.summary.entrou), inline: true },
                    { name: 'Saídas', value: String(result.json.summary.saiu), inline: true },
                    { name: 'Total', value: String(result.json.summary.total), inline: true },
                    { name: 'Promoções', value: String(result.json.summary.promovido), inline: true },
                    { name: 'Rebaixamentos', value: String(result.json.summary.rebaixado), inline: true },
                  ])
                  .setFooter({ text: `Período: ${dateDisplay}` }),
              ],
              files: [attachment],
            });
          } else {
            // Send data as embeds
            const EMBEDS_PER_MESSAGE = 10;
            for (let i = 0; i < result.embeds.length; i += EMBEDS_PER_MESSAGE) {
              const chunk = result.embeds.slice(i, i + EMBEDS_PER_MESSAGE);
              if (i === 0) await loading.edit({ embeds: chunk }); else await message.reply({ embeds: chunk });
            }
          }
        } catch (err) {
          await loading.edit({ embeds: [createErrorEmbed('Erro na API', err.message)] });
        }
      }

      // .sync (both guild and elo)
      if (command === 'sync') {
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
      }

      // .sync-nicknames
      if (command === 'sync-nicknames' || command === 'sync-nick') {
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
      }

      // .refresh-clan-cache
      if (command === 'refresh-clan-cache' || command === 'refresh-cache') {
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Atualizando...`).setDescription('Atualizando cache do clan Brawlhalla...')] });
        try {
          const clanData = await fetchBrawlhallaClanData();
          await message.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`${EMOJIS.check} Cache Atualizado`).setDescription(`${clanData.clan?.length || 0} membros`).addFields({ name: 'Clan', value: `${clanData.clan_name} (${clanData.clan_id})`, inline: true }).setTimestamp()] });
          await loading.delete();
        } catch (err) {
          await loading.edit({ embeds: [createErrorEmbed('Erro ao Atualizar Cache', err.message)] });
        }
      }

      // .active <discord_id> - Mark user as active (remove from inactive list and remove role)
      if (command === 'active') {
        try {
          if (args.length < 2 && message.mentions.size === 0) {
            return message.reply({ embeds: [createErrorEmbed('Parâmetro Inválido', 'Uso: `.active <@user>` ou `.active <discord_id>`')] });
          }
          
          let discord_id = args[1];
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            discord_id = mentionMatch[1];
          }
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');
          
          const member = await guild.members.fetch(discord_id).catch(() => null);
          if (!member) {
            return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', `Usuário com ID ${discord_id} não encontrado na guild`)] });
          }

          // Remove inactive role
          const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;
          if (member.roles.cache.has(inactiveRoleId)) {
            await member.roles.remove(inactiveRoleId);
          }

          // Remove from database
          await removeInactivePlayer(discord_id);

          const resultEmbed = createSuccessEmbed('Ativado', `${member.user.tag} foi marcado como ativo novamente.`);
          await message.reply({ embeds: [resultEmbed] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Ativar Usuário', err.message)] });
        }
      }

      // .inac <discord_id> - Mark user as inactive (admin only)
      if (command === 'inac') {
        try {
          if (args.length < 2 && message.mentions.size === 0) {
            return message.reply({ embeds: [createErrorEmbed('Parâmetro Inválido', 'Uso: `.inac <@user>` ou `.inac <discord_id>`')] });
          }
          
          let discord_id = args[1];
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            discord_id = mentionMatch[1];
          }
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');
          
          const member = await guild.members.fetch(discord_id).catch(() => null);
          if (!member) {
            return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', `Usuário com ID ${discord_id} não encontrado na guild`)] });
          }

          // Add to database
          await addInactivePlayer(discord_id);

          // Add inactive role
          const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;
          if (!member.roles.cache.has(inactiveRoleId)) {
            await member.roles.add(inactiveRoleId);
          }

          const resultEmbed = createSuccessEmbed('Marcado como Inativo', `${member.user.tag} foi adicionado à lista de inativos.`);
          await message.reply({ embeds: [resultEmbed] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Marcar Inativo', err.message)] });
        }
      }

      // .unac <discord_id> - Force remove user from inactive (admin only)
      if (command === 'unac') {
        try {
          if (args.length < 2 && message.mentions.size === 0) {
            return message.reply({ embeds: [createErrorEmbed('Parâmetro Inválido', 'Uso: `.unac <@user>` ou `.unac <discord_id>`')] });
          }
          
          let discord_id = args[1];
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            discord_id = mentionMatch[1];
          }
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');
          
          const member = await guild.members.fetch(discord_id).catch(() => null);
          if (!member) {
            return message.reply({ embeds: [createErrorEmbed('Usuário Não Encontrado', `Usuário com ID ${discord_id} não encontrado na guild`)] });
          }

          // Remove inactive role
          const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;
          if (member.roles.cache.has(inactiveRoleId)) {
            await member.roles.remove(inactiveRoleId);
          }

          // Remove from database
          await removeInactivePlayer(discord_id);

          const resultEmbed = createSuccessEmbed('Removido de Inativos', `${member.user.tag} foi removido da lista de inativos.`);
          await message.reply({ embeds: [resultEmbed] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Remover de Inativos', err.message)] });
        }
      }

      // .inac-list - List all inactive players and how long they've been inactive (admin only)
      if (command === 'inac-list') {
        try {
          const inactivePlayers = await getInactivePlayers();
          
          if (inactivePlayers.length === 0) {
            return message.reply({ embeds: [createErrorEmbed('Sem Inativos', 'Nenhum usuário marcado como inativo no momento')] });
          }

          const embeds = [];
          let currentEmbed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle(`📋 Usuários Inativos (${inactivePlayers.length})`);

          for (let i = 0; i < inactivePlayers.length; i++) {
            const player = inactivePlayers[i];
            const user = await client.users.fetch(player.discord_id).catch(() => null);
            const createdAt = new Date(player.created_at);
            const daysInactive = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            const timeStr = daysInactive === 0 ? 'Hoje' : `${daysInactive}d atrás`;
            
            const fieldValue = `${user?.tag || 'Usuário Desconhecido'} (ID: ${player.discord_id})\nMarcado: ${timeStr}`;
            
            if (currentEmbed.data.fields?.length >= 10) {
              embeds.push(currentEmbed);
              currentEmbed = new EmbedBuilder()
                .setColor(0xfaa61a)
                .setTitle(`📋 Usuários Inativos - Página ${embeds.length + 1}`);
            }
            
            currentEmbed.addFields({ name: `${i + 1}. ${user?.tag || 'Desconhecido'}`, value: `ID: ${player.discord_id}\nMarcado: ${timeStr}`, inline: false });
          }
          
          embeds.push(currentEmbed);
          
          const EMBEDS_PER_MESSAGE = 1;
          for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
            const chunk = embeds.slice(i, i + EMBEDS_PER_MESSAGE);
            if (i === 0) {
              await message.reply({ embeds: chunk });
            } else {
              await message.channel.send({ embeds: chunk });
            }
          }
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Listar Inativos', err.message)] });
        }
      }

      // .inac-test - Send test message with inactive users (admin only)
      if (command === 'inac-test') {
        try {
          const channelId = inactivePlayersConfig.channelId;
          if (!channelId) {
            return message.reply({ embeds: [createErrorEmbed('Erro de Configuração', 'INACTIVE_PLAYERS_CHANNEL_ID não configurado')] });
          }

          const channel = client.channels.cache.get(channelId);
          if (!channel) {
            return message.reply({ embeds: [createErrorEmbed('Canal Não Encontrado', `Canal com ID ${channelId} não encontrado`)] });
          }

          // Get all inactive players
          const inactivePlayers = await getInactivePlayers();
          
          if (inactivePlayers.length === 0) {
            return message.reply({ embeds: [createErrorEmbed('Sem Inativos', 'Nenhum usuário marcado como inativo no momento')] });
          }

          // Build mention string
          const mentions = inactivePlayers
            .filter(p => p.discord_id)
            .map(p => `<@${p.discord_id}>`)
            .join(' ');

          const embed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle('⚠️ Usuários Inativos')
            .setDescription(`Olá! Os seguintes usuários estão marcados como inativos:\n\n${mentions}\n\nSe você está ativo e foi adicionado por engano, use o comando \`.active\` para se remover da lista.`)
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          await message.reply({ embeds: [createSuccessEmbed('Teste Enviado', `Mensagem de teste enviada para <#${channelId}>`)] });
        } catch (err) {
          await message.reply({ embeds: [createErrorEmbed('Erro ao Enviar Teste', err.message)] });
        }
      }

    } catch (err) {
      console.error('[Command Error]', err);
      await message.reply({ embeds: [createErrorEmbed('Erro Interno', `Um erro inesperado ocorreu: ${err.message}`)] }).catch(() => {});
    }
  });

  // Periodic task to send inactive player messages (weekly by default)
  async function sendInactivePlayersReminder() {
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
        .setDescription(`Olá! Os seguintes usuários estão marcados como inativos:\n\n${mentions}\n\nSe você está ativo e foi adicionado por engano, use o comando \`.active\` para se remover da lista.`)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      console.log(`[Inactive Reminder] Sent message with ${inactivePlayers.length} inactive players`);
    } catch (err) {
      console.error('[Inactive Reminder Error]', err);
    }
  }

  // Setup periodic task (runs every week by default, or interval as configured)
  if (inactivePlayersConfig.channelId) {
    const interval = parseInt(inactivePlayersConfig.messageInterval) || 604800000; // 7 days default
    console.log(`[Scheduled] Inactive players reminder will run every ${interval}ms (${(interval / 1000 / 60 / 60 / 24).toFixed(1)} days)`);
    setInterval(sendInactivePlayersReminder, interval);
    // Run once after 5 seconds to test connectivity on startup
    setTimeout(sendInactivePlayersReminder, 5000);
  }

  await client.login(discordConfig.token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
