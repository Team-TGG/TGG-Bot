import 'dotenv/config';
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder } from 'discord.js';
import { getUsers, getUsersWithElo, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, addUser, deleteUser } from './src/db.js';
import { addWarning, getWarningCount, getUserWarnings, clearWarnings, parseTime, formatTime } from './src/moderation.js';
import { 
  getScoreTypes, 
  addTrainingSession, 
  getInstructorSessions, 
  getStudentSessions, 
  getInstructorLeaderboard, 
  getStudentLeaderboard, 
  calculateTotalScore, 
  formatTrainingMessage,
  getShopItems,
  getShopItemsByCategory,
  purchaseItem,
  applyRewardEffect,
  getUserPurchaseHistory,
  getUserPreferences,
  hasInstructorRole,
  addRoleHolderPoints,
  getRoleHolderStats,
  getRoleHolderLeaderboard
} from './src/training_system.js';
import { createClient, runSync, runEloSync } from './src/discord.js';
import { runAndPostGuildActivity } from './src/guildActivity.js';
import { fetchMovimentacao, buildMovimentacaoEmbeds, getDefaultDateRange, isValidDate, formatMovimentacaoAsText } from './src/movimentacao.js';
import { syncNicknames, updateMemberNicknameDiscordPortion, parseNickname, buildNickname, fetchBrawlhallaClanData, loadClanCache } from './src/nicknameSync.js';
import { loadCustomNicknames } from './src/customNicknames.js';
import { discord as discordConfig, ALLOWED_USER_IDS, inactivePlayers as inactivePlayersConfig } from './config/index.js';
import { getUserByDiscordId } from './src/db.js';
import { startCronJobs } from './src/scheduler/cron.js';

async function main() {
  if (!discordConfig.token || !discordConfig.guildId) {
    console.error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env');
    process.exit(1);
  }

  const client = createClient();
  const PREFIX = '.';
//think please
  const COMMAND_ALIASES = {
    'sync': 'sync',
    'sync-guild': 'sync',
    'sync-guild-roles': 'sync',
    'sync-roles': 'sync',
    'sync-elo': 'sync',
    'sync-elo-roles': 'sync',
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
    'inac-all': 'inac-all',
    'inac-list': 'inac-list',
    'regras': 'regras',
    'rules': 'regras',
    'missoes': 'missoes',
    'missions': 'missoes',
    'entrou': 'entrou',
    'saiu': 'saiu',
    'warn': 'warn',
    'mute': 'mute',
    'unmute': 'unmute',
    'ban': 'ban',
    'pontos': 'pontos',
    'instrutor': 'instrutor',
    'instrutorl': 'instrutorl',
    'loja': 'loja',
    'resgatar': 'resgatar',
  };
// emoji constant idek if that is actually useful besides junk code but it help later on ig
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
    crossedSwords: '⚔️',
    hourglass: '⏳',
  };

  client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    startCronJobs(client, {
      fetchBrawlhallaClanData,
      runSync,
      runEloSync,
      syncNicknames,
      getUsers,
      getUsersWithElo
    }); // Iniciar os crons
  });

  async function isAdmin(userId) {
    try {
      const user = await getUserByDiscordId(userId);

      if (!user) return false;
      return user.role?.toLowerCase() === 'admin' && user.active;
    } catch (err) {
      return false;
    }
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

    const content = message.content.slice(PREFIX.length).trim();
    if (!content) return;

    const args = content.split(/\s+/);
    const rawCommand = args.shift().toLowerCase();
    const command = COMMAND_ALIASES[rawCommand];

    if (!command) return; // impede "." e comandos inexistentes

    // Commands that don't require admin access
    const publicCommands = ['active', 'regras', 'help', 'missoes'];
    
    // Admin check for admin-only commands
    if (!publicCommands.includes(command) && !(await isAdmin(message.author.id))) {
      return message.reply({ embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar estes comandos.')] });
    }

    try {
      if (command === 'help') {
        const page1 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.crossedSwords} Guilda`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .missoes`, value: 'Mostrar as missões da semana atual', inline: false },
            { name: `${EMOJIS.arrowRight} .stats (WIP)`, value: 'Trazer seus status atualizados do jogo', inline: false },
            { name: `${EMOJIS.arrowRight} .progresso (WIP)`, value: 'Verificar seu progresso na missão semanal (somente do que for possível rastrear)', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();
          
        const page2 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.hourglass} Sincronização`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .sync (admin)`, value: 'Sincronização completa (ranks + ELO)', inline: false },
            { name: `${EMOJIS.arrowRight} .sync-nick (admin)`, value: 'Sincronizar apelidos Brawlhalla', inline: false },
            { name: `${EMOJIS.arrowRight} .refresh-cache (admin)`, value: 'Atualizar cache do clan', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();
        
        const page3 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.clipboard} Informações`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .guild-activity (admin)`, value: 'Sincronizar atividade da guild', inline: false },
            { name: `${EMOJIS.arrowRight} .mov [data-início] [data-fim] (admin)`, value: 'Buscar movimentação (YYYY-MM-DD)', inline: false },
            { name: `${EMOJIS.arrowRight} .regras`, value: 'Mostrar regras da guild', inline: false },
            { name: `${EMOJIS.arrowRight} .help`, value: 'Mostrar esta mensagem', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page4 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.success} Gerenciamento de Usuários`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .entrou <@user> <bhid> (admin)`, value: 'Adicionar novo usuário ao banco de dados e atribuir cargos de recruit', inline: false },
            { name: `${EMOJIS.arrowRight} .saiu <@user|@discord_id|bhid> (admin)`, value: 'Remover usuário do banco de dados e remover cargos de recruit', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page5 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.xis} Inativos`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .inac-all (admin)`, value: 'Dar o cargo "ina" a todos os players inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .active <justificativa>`, value: 'Se remover da lista de inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .active [@user] <justificativa> (admin)`, value: 'Remover jogador da lista de inativos', inline: false },
            { name: `${EMOJIS.arrowRight} .inac-list (admin)`, value: 'Listar todos os jogadores inativos desta semana', inline: false },
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page6 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.xis} Moderação`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .warn <@user> [reason] (admin)`, value: 'Adicionar aviso ao usuário (3 warns=mute, 5 warns=kick, 7 warns=ban)', inline: false },
            { name: `${EMOJIS.arrowRight} .mute <@user> <duration> (admin)`, value: 'Silenciar usuário por tempo específico (1s, 1m, 1h, 1d, 1M, 1y)', inline: false },
            { name: `${EMOJIS.arrowRight} .unmute <@user> (admin)`, value: 'Dessilenciar usuário manualmente', inline: false },
            { name: `${EMOJIS.arrowRight} .ban <@user> [reason] (admin)`, value: 'Banir usuário do servidor permanentemente', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const page7 = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${EMOJIS.success} Treinamento`)
          .addFields(
            { name: `${EMOJIS.arrowRight} .pontos [tipo] [pontos] [aluno] [obs]`, value: 'Adicionar pontos de treinamento (teamcombo, movimentacao, combos, etc)', inline: false },
            { name: `${EMOJIS.arrowRight} .instrutor <comando>`, value: 'Sistema completo para instrutores (pontos, sessao, concluir, parcial, historico, ranking, tipos)', inline: false },
            { name: `${EMOJIS.arrowRight} .loja [categoria]`, value: 'Ver loja de recompensas (cosmética, funcional, status)', inline: false },
            { name: `${EMOJIS.arrowRight} .resgatar <ID>`, value: 'Resgatar item da loja usando pontos de treinamento', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('help_menu')
          .setPlaceholder('Escolha uma categoria...')
          .addOptions(
            { label: 'Guilda', value: 'guild', emoji: EMOJIS.crossedSwords, description: 'Comandos da guilda' },
            { label: 'Sincronização', value: 'sync', emoji: EMOJIS.hourglass, description: 'Comandos de sincronização' },
            { label: 'Informações', value: 'info', emoji: EMOJIS.clipboard, description: 'Comandos de informação' },
            { label: 'Gerenciamento', value: 'users', emoji: EMOJIS.success, description: 'Gerenciamento de usuários' },
            { label: 'Inativos', value: 'inac', emoji: EMOJIS.xis, description: 'Comandos de inatividade' },
            { label: 'Moderação', value: 'mod', emoji: EMOJIS.xis, description: 'Comandos de moderação' },
            { label: 'Treinamento', value: 'training', emoji: EMOJIS.success, description: 'Sistema de treinamento' }
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
            if (selected === 'sync') embedToShow = page2;
            if (selected === 'info') embedToShow = page3;
            if (selected === 'users') embedToShow = page4;
            if (selected === 'inac') embedToShow = page5;
            if (selected === 'mod') embedToShow = page6;
            if (selected === 'training') embedToShow = page7;
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

      // .active <discord_id>
      if (command === 'active') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;

          let targetId;
          let note;

          const mentionMatch = message.content.match(/<@!?(\d+)>/);

          // Bloqueia comando se não for admin
          if (mentionMatch && !(await isAdmin(message.author.id))) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Acesso Negado',
                  'Apenas administradores podem ativar outros usuários.'
                )
              ]
            });
          }

          // Comando marcando alguém liberado somente pra admin
          if (await isAdmin(message.author.id) && mentionMatch) {
            targetId = mentionMatch[1];

            const afterMention = message.content.split('>').slice(1).join('>').trim();
            note = afterMention.length > 0 ? afterMention : 'ativado por administrador';
          } 
          // Usuário normal usando .active <motivo>
          else {
            targetId = message.author.id;
            note = args.join(' ').trim();

            if (!note || note.length === 0) {
              note = 'usou o comando /active';
            }
          }

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          // Remove cargo de inativo
          if (member.roles.cache.has(inactiveRoleId)) {
            await member.roles.remove(inactiveRoleId);
          }

          // Atualiza banco passando a justificativa
          await removeInactivePlayer(targetId, note);

          const embed = createSuccessEmbed(
            'Ativado',
            `${member.user.tag} foi marcado como ativo.\nMotivo: ${note}`
          );

          await message.reply({ embeds: [embed] });

        // Tratamento de erros
        } catch (err) {

          // Já está ativo
          if (err.message.includes('já está ativo')) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Já está ativo',
                  'Este usuário já está marcado como ativo nesta semana.'
                )
              ]
            });
          }

          // Não está marcado como inativo
          if (err.message.includes('não está marcado como inativo')) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Não está inativo',
                  'Este usuário não está marcado como inativo nesta semana.'
                )
              ]
            });
          }

          // Fallback dos erros
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Ativar Usuário', err.message)]
          });
        }
      }

      // .regras (Display guild rules)
      if (command === 'regras') {
        const rulesEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('📋 Regras da Guild')
          .setDescription('Bem-vindo à TGG! Aqui estão nossas regras simples para uma comunidade saudável.')
          .addFields(
            {
              name: `${EMOJIS.square} Sem Toxicidade`,
              value: 'Proibido nomes ofensivos, assédio ou desrespeito.',
              inline: false
            },
            {
              name: `${EMOJIS.square} Contribua com a Guilda`,
              value: `Ajude a guilda participando de missões, quests e atividades coletivas. Para mais informações, veja o canal <#${'1465513473583616011'}>`,
              inline: false
            },
            {
              name: `${EMOJIS.arrowRight} Como Contribuir:`,
              value: `${EMOJIS.check} Jogar 2v2 amistoso ou ranked com membros da guild\n${EMOJIS.check} Ajudar com missões da guilda`,
              inline: false
            },
            {
              name: `${EMOJIS.arrowRight} Vire membro e desbloqueie treinamentos gratuitos com jogadores experientes da guilda!`,
              value: `${EMOJIS.check} Consiga 40.000 de contribuição total
                      ${EMOJIS.check} Seja MVP Semanal (14 melhores contribuidores da semana)`,
              inline: false
            },
            {
              name: `${EMOJIS.greaterthan} Seja Bem-Vindo!`,
              value: 'Divirta-se, conheça os membros e aproveite a comunidade. Vamos crescer juntos!',
              inline: false
            }
          )
          .setFooter({ text: 'Dúvidas? Fale com um membro da staff!' })
          .setTimestamp();

        await message.reply({ embeds: [rulesEmbed] });
      }

      // .inac-all (Give "ina" role to all inactive members)
      if (command === 'inac-all') {
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
      }

      // .inac-list
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

      // .missoes
      if (command === 'missoes') {
        try {
          const missions = await getWeeklyMissions();

          if (!missions || missions.length === 0) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Missões',
                  'Nenhuma missão encontrada para esta semana.'
                )
              ]
            });
          }

          const weekDate = new Date(missions[0].week_start + 'T00:00:00').toLocaleDateString('pt-BR');

          const description = missions
            .map((m) => {
              return `🎯 **${m.mission}**
                Objetivo: ${m.target} pontos
                _DICA: ${m.tip}_`;
              })
            .join('\n\n');

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📜 Missões Semanais (${weekDate})`)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━\n${description}\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nSe tiver dúvidas, contate alguém da staff.`
            )
            .setTimestamp();

          await message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [
              createErrorEmbed('Erro ao buscar missões', err.message)
            ]
          });
        }
      }

      // .entrou <@user> <brawlhalla_id>
      if (command === 'entrou') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          // Parse command arguments
          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (!mentionMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.entrou <@user> <brawlhalla_id>`')]
            });
          }

          const targetId = mentionMatch[1];
          const brawlhallaId = args[1]; // Get brawlhalla_id from args

          if (!brawlhallaId || !/^\d+$/.test(brawlhallaId)) {
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

          // Add user to database
          const result = await addUser(targetId, brawlhallaId, member.user.tag);

          // Role management - remove old roles and add recruit roles
          const rolesToRemove = ['1466815420630565069', '1478477041077588098', '1437447173896802395'];
          const rolesToAdd = ['1437441679572471940', '1437427750209327297'];

          // Remove old roles
          for (const roleId of rolesToRemove) {
            if (member.roles.cache.has(roleId)) {
              await member.roles.remove(roleId);
            }
          }

          // Add new recruit roles
          for (const roleId of rolesToAdd) {
            if (!member.roles.cache.has(roleId)) {
              await member.roles.add(roleId);
            }
          }

          const embed = createSuccessEmbed(
            'Usuário Adicionado',
            `${member.user.tag} foi adicionado ao banco de dados.\n**Brawlhalla ID:** ${brawlhallaId}\n**Cargo:** Recruit\n\nCargos atualizados com sucesso!`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          // Handle specific errors
          if (err.message.includes('já existe no banco de dados')) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Já Existe', err.message)]
            });
          }

          await message.reply({
            embeds: [createErrorEmbed('Erro ao Adicionar Usuário', err.message)]
          });
        }
      }

      // .saiu <@user|@discord_id|brawlhalla_id>
      if (command === 'saiu') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.saiu <@user|@discord_id|brawlhalla_id>`')]
            });
          }

          const identifier = args[0];
          let deletedUser;
          let member = null;
          let actualIdentifier = identifier;

          // Parse different identifier formats
          if (identifier.startsWith('<@') && identifier.endsWith('>')) {
            // Discord mention like <@123456789> or <@!123456789>
            const mentionMatch = identifier.match(/<@!?(\d+)>/);
            if (mentionMatch) {
              actualIdentifier = mentionMatch[1]; // Extract the numeric ID
              member = await guild.members.fetch(actualIdentifier).catch(() => null);
            }
          } else if (identifier.startsWith('@')) {
            // Discord ID with @ prefix like @123456789
            actualIdentifier = identifier.slice(1);
            member = await guild.members.fetch(actualIdentifier).catch(() => null);
          } else {
            // Brawlhalla ID (numbers only)
            actualIdentifier = identifier;
          }

          // Delete user from database using the appropriate identifier format
          const dbIdentifier = (identifier.startsWith('<@') || identifier.startsWith('@')) ? `@${actualIdentifier}` : actualIdentifier;
          deletedUser = await deleteUser(dbIdentifier);

          // If we have a member, remove recruit roles
          if (member) {
            const recruitRoles = ['1437441679572471940', '1437427750209327297'];
            for (const roleId of recruitRoles) {
              if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
              }
            }
          }

          const embed = createSuccessEmbed(
            'Usuário Removido',
            `**Usuário:** ${deletedUser.username}\n**Discord ID:** ${deletedUser.discord_id}\n**Brawlhalla ID:** ${deletedUser.brawlhalla_id}\n\nUsuário removido do banco de dados com sucesso!${member ? '\nCargos de recruit removidos.' : ''}`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          // Handle specific errors
          if (err.message.includes('não encontrado')) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', err.message)]
            });
          }

          await message.reply({
            embeds: [createErrorEmbed('Erro ao Remover Usuário', err.message)]
          });
        }
      }

      // .warn <@user> [reason]
      if (command === 'warn') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (!mentionMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.warn <@user> [reason]`')]
            });
          }

          const targetId = mentionMatch[1];
          const reason = message.content.split('>').slice(1).join('>').trim() || 'Sem motivo especificado';

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          // Add warning
          const warningCount = addWarning(targetId, message.author.id, reason);

          const embed = createSuccessEmbed(
            'Aviso Adicionado',
            `${member.user.tag} recebeu um aviso.\n**Motivo:** ${reason}\n**Total de avisos:** ${warningCount}/7`
          );

          await message.reply({ embeds: [embed] });

          // Warning escalation logic
          if (warningCount === 3) {
            // Auto mute for 10 minutes on 3rd warning
            const muteRole = guild.roles.cache.find(r => r.name === 'Muted');
            if (muteRole) {
              await member.roles.add(muteRole);
              setTimeout(() => {
                member.roles.remove(muteRole).catch(() => {});
              }, 10 * 60 * 1000); // 10 minutes
              
              await message.channel.send({
                embeds: [new EmbedBuilder()
                  .setColor(0xfaa61a)
                  .setTitle('⚠️ Auto-Mute')
                  .setDescription(`${member.user.tag} foi silenciado por 10 minutos devido a 3 avisos.`)]
              });
            }
          } else if (warningCount === 5) {
            // Auto kick on 5th warning
            await member.kick('5 avisos acumulados');
            await message.channel.send({
              embeds: [new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('👢 Auto-Kick')
                .setDescription(`${member.user.tag} foi expulso devido a 5 avisos acumulados.`)]
            });
          } else if (warningCount === 7) {
            // Auto ban on 7th warning
            await member.ban({ reason: '7 avisos acumulados' });
            await message.channel.send({
              embeds: [new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('🔨 Auto-Ban')
                .setDescription(`${member.user.tag} foi banido devido a 7 avisos acumulados.`)]
            });
          }

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Adicionar Aviso', err.message)]
          });
        }
      }

      // .mute <@user> <duration>
      if (command === 'mute') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (!mentionMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.mute <@user> <duration>`')]
            });
          }

          const targetId = mentionMatch[1];
          const durationMatch = message.content.match(/\b(\d+[smhdMy])\b/);
          
          if (!durationMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Duração Inválida', 'Use formatos como: 1s, 1m, 1h, 1d, 1M, 1y')]
            });
          }

          const duration = durationMatch[1];
          const durationMs = parseTime(duration);
          
          if (!durationMs) {
            return message.reply({
              embeds: [createErrorEmbed('Duração Inválida', 'Formato de duração não reconhecido.')]
            });
          }

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          // Check for existing Muted role or create it
          let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
          if (!muteRole) {
            muteRole = await guild.roles.create({
              name: 'Muted',
              color: 0x808080,
              reason: 'Cargo para usuários silenciados'
            });
          }

          // Apply voice mute if user is in voice
          if (member.voice.channel) {
            await member.voice.setMute(true, 'Usuário silenciado por moderação');
          }

          await member.roles.add(muteRole);

          const embed = createSuccessEmbed(
            'Usuário Silenciado',
            `${member.user.tag} foi silenciado por ${formatTime(durationMs)}.\n**Voice mute:** ${member.voice.channel ? 'Sim' : 'Não'}`
          );

          await message.reply({ embeds: [embed] });

          // Store mute info for auto-unmute
          const muteInfo = {
            userId: targetId,
            endTime: Date.now() + durationMs,
            wasInVoice: !!member.voice.channel,
            originalVoiceState: member.voice.serverMute
          };

          // Auto unmute after duration
          setTimeout(async () => {
            try {
              const guild = client.guilds.cache.get(discordConfig.guildId);
              const user = await guild.members.fetch(targetId).catch(() => null);
              
              if (user && user.roles.cache.has(muteRole.id)) {
                await user.roles.remove(muteRole);
                
                // Restore voice state if they were muted in voice
                if (muteInfo.wasInVoice && !muteInfo.originalVoiceState) {
                  await user.voice.setMute(false, 'Auto-unmute');
                }
                
                await message.channel.send({
                  embeds: [new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle('✅ Desmutado')
                    .setDescription(`${user.user.tag} foi desmutado automaticamente.`)]
                });
              }
            } catch (err) {
              console.log('[Auto-Unmute Error]', err);
            }
          }, durationMs);

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Silenciar Usuário', err.message)]
          });
        }
      }

      // .ban <@user> [reason]
      if (command === 'ban') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (!mentionMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.ban <@user> [reason]`')]
            });
          }

          const targetId = mentionMatch[1];
          const reason = message.content.split('>').slice(1).join('>').trim() || 'Sem motivo especificado';

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          await member.ban({ reason });

          const embed = createSuccessEmbed(
            'Usuário Banido',
            `${member.user.tag} foi banido.\n**Motivo:** ${reason}`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Banir Usuário', err.message)]
          });
        }
      }

      // .unmute <@user>
      if (command === 'unmute') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (!mentionMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unmute <@user>`')]
            });
          }

          const targetId = mentionMatch[1];

          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          const muteRole = guild.roles.cache.find(r => r.name === 'Muted');
          if (!muteRole || !member.roles.cache.has(muteRole.id)) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Silenciado', 'Este usuário não está silenciado no momento.')]
            });
          }

          // Remove mute role
          await member.roles.remove(muteRole);

          // Unmute voice if they were voice muted
          if (member.voice.serverMute) {
            await member.voice.setMute(false, 'Usuário dessilenciado por moderação');
          }

          const embed = createSuccessEmbed(
            'Usuário Desmutado',
            `${member.user.tag} foi desmutado com sucesso.\n**Voice mute:** ${member.voice.serverMute ? 'Removido' : 'Não aplicado'}`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Desmutar Usuário', err.message)]
          });
        }
      }

      // .pontos [tipo] [pontos] [aluno] [observações]
      if (command === 'pontos') {
        try {
          // Check if user has instructor role
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const member = await guild.members.fetch(message.author.id).catch(() => null);
          const instructorRoleId = '1461134737505652806'; // You should replace this with your actual instructor role ID
          
          if (!hasInstructorRole(member, instructorRoleId)) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Apenas usuários com cargo de instrutor podem usar este comando.')]
            });
          }

          if (args.length < 3) {
            const scoreTypes = getScoreTypes();
            const typeList = Object.entries(scoreTypes).map(([key, type]) => 
              `**${key}** - ${type.name} (${type.base_points} pontos base, multiplicador ${type.multiplier}x)`
            ).join('\n');
            
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 
                `Uso: \`.pontos [tipo] [pontos] [aluno] [observações]\`\n\nTipos disponíveis:\n\n${typeList}`)]
            });
          }

          const [type, points, studentId, ...notes] = args;
          const scoreTypes = getScoreTypes();
          const scoreType = scoreTypes[type];
          
          if (!scoreType) {
            return message.reply({
              embeds: [createErrorEmbed('Tipo Inválido', 'Tipo de pontuação não encontrado. Use `.pontos` para ver os tipos disponíveis.')]
            });
          }

          const parsedPoints = parseInt(points);
          if (isNaN(parsedPoints) || parsedPoints <= 0) {
            return message.reply({
              embeds: [createErrorEmbed('Pontos Inválidos', 'Os pontos devem ser um número maior que zero.')]
            });
          }

          const student = await guild.members.fetch(studentId).catch(() => null);
          if (!student) {
            return message.reply({
              embeds: [createErrorEmbed('Aluno Não Encontrado', 'Não foi possível encontrar o aluno na guild.')]
            });
          }

          const actualPoints = parsedPoints * scoreType.base_points * scoreType.multiplier;
          const observations = notes.join(' ') || 'Treinamento concluído';

          const session = addTrainingSession(
            message.author.id,
            studentId,
            type,
            'Concluído',
            actualPoints,
            observations,
            'complete'
          );

          // Track points for role holders (instructor role 1461134737505652806)
          const instructorMember = await guild.members.fetch(message.author.id).catch(() => null);
          if (instructorMember && hasInstructorRole(instructorMember, '1461134737505652806')) {
            addRoleHolderPoints(message.author.id, actualPoints, type);
          }

          const embed = createSuccessEmbed(
            'Pontos Registrados',
            `**Instrutor:** ${message.author.tag}\n**Aluno:** ${student.user.tag}\n**Tipo:** ${scoreType.name}\n**Pontos base:** ${scoreType.base_points}\n**Multiplicador:** ${scoreType.multiplier}x\n**Pontos totais:** ${actualPoints}\n**Observações:** ${notes}`
          );

          await message.reply({ embeds: [embed] });

          // Send training completion message to student (if different from instructor)
          if (student.id !== message.author.id) {
            try {
              const messageTemplate = getScoreTypes().training_messages.complete;
              const formattedMessage = formatTrainingMessage(messageTemplate, {
                instructor: message.author.tag,
                student: student.user.tag,
                type: scoreType.name,
                duration: 'Concluído',
                points: actualPoints,
                notes: notes
              });

              await student.send({
                embeds: [new EmbedBuilder()
                  .setColor(0x57f287)
                  .setTitle('🎯 Treinamento Concluído!')
                  .setDescription(formattedMessage)]
              });
            } catch (err) {
              console.log('Error sending training completion message:', err);
            }
          }

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Registrar Pontos', err.message)]
          });
        }
      }

      // .instrutor <comando>
      if (command === 'instrutor') {
        try {
          // Check if user has instructor role
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const member = await guild.members.fetch(message.author.id).catch(() => null);
          const instructorRoleId = '1461134737505652806'; // You should replace this with your actual instructor role ID
          
          if (!hasInstructorRole(member, instructorRoleId)) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Apenas usuários com cargo de instrutor podem usar este comando.')]
            });
          }

          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 
                `Uso: \`.instrutor <comando>\`\n\nComandos disponíveis:\n• \`pontos [tipo] [pontos] [aluno] [observações]\` - Registrar pontos\n• \`sessao [tipo] [pontos] [aluno] [duração] [observações]\` - Iniciar sessão\n• \`concluir [ID] [observações]\` - Concluir sessão\n• \`parcial [ID] [pontos] [observações]\` - Registrar progresso parcial\n• \`historico [aluno|ID]\` - Ver histórico\n• \`ranking\` - Ver ranking\n• \`tipos\` - Ver tipos de pontuação`)]
            });
          }

          const subCommand = args[0].toLowerCase();
          const instructorId = message.author.id;

          switch (subCommand) {
            case 'pontos':
              if (args.length < 4) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutor pontos [tipo] [pontos] [aluno] [observações]`')]
                });
              }

              const [cmdType, cmdPoints, cmdStudentId, ...cmdNotes] = args.slice(1);
              const cmdScoreTypes = getScoreTypes();
              const cmdScoreType = cmdScoreTypes[cmdType];
              
              if (!cmdScoreType) {
                return message.reply({
                  embeds: [createErrorEmbed('Tipo Inválido', 'Tipo não encontrado. Use `.instrutor tipos` para ver os disponíveis.')]
                });
              }

              const cmdParsedPoints = parseInt(cmdPoints);
              if (isNaN(cmdParsedPoints) || cmdParsedPoints <= 0) {
                return message.reply({
                  embeds: [createErrorEmbed('Pontos Inválidos', 'Os pontos devem ser um número maior que zero.')]
                });
              }

              const cmdStudent = await guild.members.fetch(cmdStudentId).catch(() => null);
              if (!cmdStudent) {
                return message.reply({
                  embeds: [createErrorEmbed('Aluno Não Encontrado', 'Não foi possível encontrar o aluno na guild.')]
                });
              }

              const cmdActualPoints = cmdParsedPoints * cmdScoreType.base_points * cmdScoreType.multiplier;
              const cmdObservations = cmdNotes.join(' ') || 'Treinamento concluído';

              const cmdSession = addTrainingSession(
                instructorId,
                cmdStudentId,
                cmdType,
                'Concluído',
                cmdActualPoints,
                cmdObservations,
                'complete'
              );

              const cmdEmbed = createSuccessEmbed(
                'Pontos Registrados',
                `**Instrutor:** ${message.author.tag}\n**Aluno:** ${cmdStudent.user.tag}\n**Tipo:** ${cmdScoreType.name}\n**Pontos base:** ${cmdScoreType.base_points}\n**Multiplicador:** ${cmdScoreType.multiplier}x\n**Pontos totais:** ${cmdActualPoints}\n**Observações:** ${cmdObservations}`
              );

              await message.reply({ embeds: [cmdEmbed] });
              break;

            case 'sessao':
              if (args.length < 4) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutor sessao [tipo] [pontos] [aluno] [duração] [observações]`')]
                });
              }

              const [sessType, sessPoints, sessStudentId, sessDuration, ...sessNotes] = args.slice(1);
              const sessScoreTypes = getScoreTypes();
              const sessScoreType = sessScoreTypes[sessType];
              
              if (!sessScoreType) {
                return message.reply({
                  embeds: [createErrorEmbed('Tipo Inválido', 'Tipo não encontrado. Use `.instrutor tipos` para ver os disponíveis.')]
                });
              }

              const sessStudent = await guild.members.fetch(sessStudentId).catch(() => null);
              if (!sessStudent) {
                return message.reply({
                  embeds: [createErrorEmbed('Aluno Não Encontrado', 'Não foi possível encontrar o aluno na guild.')]
                });
              }

              // Create training session without points (will be added on completion)
              const sessSession = addTrainingSession(
                instructorId,
                sessStudentId,
                sessType,
                sessDuration,
                0, // No points yet
                sessNotes.join(' ') || 'Sessão iniciada',
                'active' // Active status
              );

              const sessStartMessage = formatTrainingMessage(
                getScoreTypes().training_messages.start,
                {
                  instructor: message.author.tag,
                  student: sessStudent.user.tag,
                  type: sessScoreType.name,
                  duration: sessDuration,
                  description: sessNotes.join(' ') || 'Sessão de treinamento'
                }
              );

              const sessEmbed = createSuccessEmbed(
                'Sessão Iniciada',
                `**Instrutor:** ${message.author.tag}\n**Aluno:** ${sessStudent.user.tag}\n**Tipo:** ${sessScoreType.name}\n**Duração:** ${sessDuration}\n**Status:** Ativa\n**ID da Sessão:** ${sessSession.id}`
              );

              await message.reply({ embeds: [sessEmbed] });

              // Send start message to student
              if (sessStudent.id !== instructorId) {
                try {
                  await sessStudent.send({
                    embeds: [new EmbedBuilder()
                      .setColor(0xfaa61a)
                      .setTitle('🎓 Início do Treinamento')
                      .setDescription(sessStartMessage)]
                  });
                } catch (err) {
                  console.log('Error sending training start message:', err);
                }
              }
              break;

            case 'concluir':
              if (args.length < 2) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutor concluir [ID] [observações]`')]
                });
              }

              const [compSessionId, ...compNotes] = args.slice(1);
              const compData = readTrainingData();
              const compSession = compData.training_sessions.find(s => s.id === compSessionId);
              
              if (!compSession) {
                return message.reply({
                  embeds: [createErrorEmbed('Sessão Não Encontrada', 'ID da sessão não encontrado.')]
                });
              }

              if (compSession.status === 'complete') {
                return message.reply({
                  embeds: [createErrorEmbed('Sessão Já Concluída', 'Esta sessão já foi concluída anteriormente.')]
                });
              }

              const compScoreTypes = getScoreTypes();
              const compScoreType = compScoreTypes[compSession.type];
              const compActualPoints = parseInt(compNotes[0]) || 0;

              if (isNaN(compActualPoints) || compActualPoints <= 0) {
                return message.reply({
                  embeds: [createErrorEmbed('Pontos Inválidos', 'Os pontos devem ser um número maior que zero.')]
                });
              }

              // Update session with points and mark as complete
              compSession.points = compActualPoints;
              compSession.notes = compNotes.slice(1).join(' ') || 'Treinamento concluído';
              compSession.status = 'complete';

              // Update scores
              if (!compData.student_scores[compSession.student_id]) {
                compData.student_scores[compSession.student_id] = {};
              }
              if (!compData.student_scores[compSession.student_id][compSession.type]) {
                compData.student_scores[compSession.student_id][compSession.type] = 0;
              }
              compData.student_scores[compSession.student_id][compSession.type] += compActualPoints;

              if (!compData.instructor_scores[compSession.instructor_id]) {
                compData.instructor_scores[compSession.instructor_id] = {};
              }
              if (!compData.instructor_scores[compSession.instructor_id][compSession.type]) {
                compData.instructor_scores[compSession.instructor_id][compSession.type] = 0;
              }
              compData.instructor_scores[compSession.instructor_id][compSession.type] += compActualPoints;

              updateLeaderboards(compData);
              writeTrainingData(compData);

              // Track points for role holders (instructor role 1461134737505652806)
              const compInstructorMember = await guild.members.fetch(compSession.instructor_id).catch(() => null);
              if (compInstructorMember && hasInstructorRole(compInstructorMember, '1461134737505652806')) {
                addRoleHolderPoints(compSession.instructor_id, compActualPoints, compSession.type);
              }

              const compEmbed = createSuccessEmbed(
                'Sessão Concluída',
                `**ID da Sessão:** ${compSessionId}\n**Aluno:** <@${compSession.student_id}>\n**Tipo:** ${compScoreType.name}\n**Pontos ganhos:** ${compActualPoints}\n**Observações:** ${compSession.notes}`
              );

              await message.reply({ embeds: [compEmbed] });
              break;

            case 'parcial':
              if (args.length < 3) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutor parcial [ID] [pontos] [observações]`')]
                });
              }

              const [partSessionId, partPoints, ...partNotes] = args.slice(1);
              const partData = readTrainingData();
              const partSession = partData.training_sessions.find(s => s.id === partSessionId);
              
              if (!partSession) {
                return message.reply({
                  embeds: [createErrorEmbed('Sessão Não Encontrada', 'ID da sessão não encontrado.')]
                });
              }

              const partParsedPoints = parseInt(partPoints);
              if (isNaN(partParsedPoints) || partParsedPoints <= 0) {
                return message.reply({
                  embeds: [createErrorEmbed('Pontos Inválidos', 'Os pontos devem ser um número maior que zero.')]
                });
              }

              const partScoreTypes = getScoreTypes();
              const partScoreType = partScoreTypes[partSession.type];
              const partActualPoints = partParsedPoints * partScoreType.base_points * partScoreType.multiplier;

              // Add partial points
              if (!partData.student_scores[partSession.student_id]) {
                partData.student_scores[partSession.student_id] = {};
              }
              if (!partData.student_scores[partSession.student_id][partSession.type]) {
                partData.student_scores[partSession.student_id][partSession.type] = 0;
              }
              partData.student_scores[partSession.student_id][partSession.type] += partActualPoints;

              if (!partData.instructor_scores[partSession.instructor_id]) {
                partData.instructor_scores[partSession.instructor_id] = {};
              }
              if (!partData.instructor_scores[partSession.instructor_id][partSession.type]) {
                partData.instructor_scores[partSession.instructor_id][partSession.type] = 0;
              }
              partData.instructor_scores[partSession.instructor_id][partSession.type] += partActualPoints;

              updateLeaderboards(partData);
              writeTrainingData(partData);

              const partEmbed = createSuccessEmbed(
                'Progresso Parcial Registrado',
                `**ID da Sessão:** ${partSessionId}\n**Aluno:** <@${partSession.student_id}>\n**Tipo:** ${partScoreType.name}\n**Pontos parciais:** ${partActualPoints}\n**Observações:** ${partNotes.join(' ')}`
              );

              await message.reply({ embeds: [partEmbed] });
              break;

            case 'historico':
              if (args.length < 2) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutor historico [aluno|ID]`')]
                });
              }

              const histIdentifier = args[1];
              const histHistory = histIdentifier.startsWith('<@') 
                ? getStudentSessions(histIdentifier.slice(2, -1))
                : getInstructorSessions(message.author.id).filter(s => s.student_id === histIdentifier);

              if (histHistory.length === 0) {
                return message.reply({
                  embeds: [createErrorEmbed('Sem Histórico', 'Nenhuma sessão encontrada para este usuário.')]
                });
              }

              const histEmbed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`📚 Histórico de Treinamentos`)
                .setDescription(histHistory.slice(0, 15).map((session, index) => {
                  const histScoreTypes = getScoreTypes();
                  const histScoreType = histScoreTypes[session.type];
                  const histDate = new Date(session.timestamp).toLocaleDateString('pt-BR');
                  const histStatusIcon = session.status === 'complete' ? '✅' : session.status === 'active' ? '🔄' : '⏸️';
                  return `**${index + 1}.** ${histStatusIcon} <@${session.student_id}> - ${histScoreType.name} (${session.points} pontos) - ${histDate}`;
                }).join('\n\n'))
                .setFooter({ text: `Mostrando 15 mais recentes` })
                .setTimestamp();

              await message.reply({ embeds: [histEmbed] });
              break;

            case 'ranking':
              const rankInstructorLeaderboard = getInstructorLeaderboard();
              const rankStudentLeaderboard = getStudentLeaderboard();

              const rankEmbed = new EmbedBuilder()
                .setColor(0xfaa61a)
                .setTitle('🏆 Ranking Geral')
                .setDescription('**👨‍🏫 Ranking de Instrutores:**\n\n' + 
                  rankInstructorLeaderboard.slice(0, 5).map((entry, index) => {
                    const rankTotalScore = calculateTotalScore(entry.instructor_id, true);
                    return `**${index + 1}.** <@${entry.instructor_id}> - **${rankTotalScore} pontos**`;
                  }).join('\n\n') +
                  '\n\n**🎓 Ranking de Alunos:**\n\n' +
                  rankStudentLeaderboard.slice(0, 5).map((entry, index) => {
                    const rankTotalScore = calculateTotalScore(entry.student_id, false);
                    return `**${index + 1}.** <@${entry.student_id}> - **${rankTotalScore} pontos**`;
                  }).join('\n\n')
                )
                .setFooter({ text: 'Top 5 de cada categoria' })
                .setTimestamp();

              await message.reply({ embeds: [rankEmbed] });
              break;

            case 'tipos':
              const typesScoreTypes = getScoreTypes();
              const typesEmbed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('📊 Tipos de Pontuação')
                .setDescription(Object.entries(typesScoreTypes).map(([key, type]) => 
                  `**${key}** - ${type.name}\n   **Pontos base:** ${type.base_points}\n   **Multiplicador:** ${type.multiplier}x\n   **Descrição:** Treinamento de ${type.name.toLowerCase()}`
                ).join('\n\n'))
                .setTimestamp();

              await message.reply({ embeds: [typesEmbed] });
              break;

            case 'role':
            case 'cargo':
              if (args.length < 2) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutor role [aluno|stats|top]`')]
                });
              }

              const roleSubCommand = args[1].toLowerCase();
              
              switch (roleSubCommand) {
                case 'stats':
                  const roleStats = getRoleHolderStats(message.author.id);
                  const roleEmbed = createSuccessEmbed(
                    '📊 Estatísticas de Instrutor (Cargo)',
                    `**Pontos totais:** ${roleStats.total_points}\n**Sessões completadas:** ${roleStats.sessions_completed}\n**Última atividade:** ${roleStats.last_activity ? new Date(roleStats.last_activity).toLocaleDateString('pt-BR') : 'Nunca'}\n\n**Tipos de treinamento:**\n${Object.entries(roleStats.types_completed || {}).map(([type, count]) => `• ${type}: ${count} sessões`).join('\n')}`
                  );
                  await message.reply({ embeds: [roleEmbed] });
                  break;

                case 'top':
                  const roleLeaderboard = getRoleHolderLeaderboard();
                  const roleTopEmbed = new EmbedBuilder()
                    .setColor(0xfaa61a)
                    .setTitle('🏆 Top Instrutores (Cargo 1461134737505652806)')
                    .setDescription(roleLeaderboard.slice(0, 10).map((entry, index) => {
                      return `**${index + 1}.** <@${entry.user_id}> - **${entry.total_points} pontos**\n   Sessões: ${entry.sessions_completed}`;
                    }).join('\n\n'))
                    .setFooter({ text: 'Ranking específico para detentores do cargo de instrutor' })
                    .setTimestamp();
                  await message.reply({ embeds: [roleTopEmbed] });
                  break;

                default:
                  return message.reply({
                    embeds: [createErrorEmbed('Subcomando Inválido', 'Use: `stats` para estatísticas pessoais ou `top` para ranking')]
                  });
              }
              break;
          }

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro no Comando', err.message)]
          });
        }
      }

      // .loja [categoria]
      if (command === 'loja') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const category = args[0]?.toLowerCase();
          const shopItems = category ? getShopItemsByCategory(category) : getShopItems();
          
          if (shopItems.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Categoria Inválida', 'Categoria não encontrada. Use `.loja` para ver todas as categorias.')]
            });
          }

          // Group items by category
          const itemsByCategory = {};
          shopItems.forEach(item => {
            if (!itemsByCategory[item.category]) {
              itemsByCategory[item.category] = [];
            }
            itemsByCategory[item.category].push(item);
          });

          const shopEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('🛍 Loja de Recompensas')
            .setDescription('Use `.resgatar [ID]` para comprar um item')
            .setTimestamp();

          Object.entries(itemsByCategory).forEach(([cat, items]) => {
            const categoryEmoji = {
              'Cosmética': '✨',
              'Funcional': '⚙️',
              'Status': '👑'
            }[cat] || '📦';

            const itemsList = items.map(item => {
              const userPoints = calculateTotalScore(message.author.id, false);
              const canAfford = userPoints >= item.cost;
              const status = canAfford ? '✅' : '❌';
              
              return `**${item.id}** ${status} - ${item.name} (${item.cost} pts)\n   ${item.description}`;
            }).join('\n\n');

            shopEmbed.addFields({
              name: `${categoryEmoji} ${cat}`,
              value: itemsList,
              inline: false
            });
          });

          // Show user's current points
          const userPoints = calculateTotalScore(message.author.id, false);
          shopEmbed.addFields({
            name: '💰 Seus Pontos',
            value: `Você tem **${userPoints} pontos** disponíveis.`,
            inline: false
          });

          await message.reply({ embeds: [shopEmbed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro na Loja', err.message)]
          });
        }
      }

      // .resgatar <item_id>
      if (command === 'resgatar') {
        try {
          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.resgatar [ID]`')]
            });
          }

          const itemId = args[0];
          const userPoints = calculateTotalScore(message.author.id, false);

          try {
            const result = purchaseItem(message.author.id, itemId);
            
            const embed = createSuccessEmbed(
              'Compra Realizada',
              `**Item:** ${result.item.name}\n**Custo:** ${result.item.cost} pontos\n**Pontos restantes:** ${result.remaining_points}\n\n${result.item.description}`
            );

            await message.reply({ embeds: [embed] });

            // Apply reward effect
            applyRewardEffect(message.author.id, result.item);

            // Send purchase confirmation
            const confirmationEmbed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('🛍 Compra Confirmada!')
              .setDescription(`Você comprou **${result.item.name}** com sucesso!\n\nO efeito será aplicado em breve.`)
              .setTimestamp();

            await message.author.send({ embeds: [confirmationEmbed] });

          } catch (err) {
            await message.reply({
              embeds: [createErrorEmbed('Erro na Compra', err.message)]
            });
          }

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Resgatar', err.message)]
          });
        }
      }

      // .instrutorl (simplified instructor commands)
      if (command === 'instrutorl') {
        try {
          // Check if user has instructor role
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const member = await guild.members.fetch(message.author.id).catch(() => null);
          const instructorRoleId = '1461134737505652806'; // You should replace this with your actual instructor role ID
          
          if (!hasInstructorRole(member, instructorRoleId)) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Apenas usuários com cargo de instrutor podem usar este comando.')]
            });
          }

          if (args.length === 0) {
            const embed = createSuccessEmbed(
              '🎓 Comando Simplificado de Instrutor',
              '**Como usar:** `.instrutorl [ação] [parâmetros]`\n\n' +
              '**Ações disponíveis:**\n\n' +
              '**👨‍🏫 Iniciar treinamento:**\n' +
              '`.instrutorl iniciar [tipo] [aluno] [duração]`\n' +
              'Exemplo: `.instrutorl iniciar teamcombo @aluno 2h`\n\n' +
              '**✅ Finalizar treinamento:**\n' +
              '`.instrutorl finalizar [ID] [pontos]`\n' +
              'Exemplo: `.instrutorl finalizar abc123 25`\n\n' +
              '**📊 Minhas estatísticas:**\n' +
              '`.instrutorl stats`\n\n' +
              '**🏆 Top instrutores:**\n' +
              '`.instrutorl top`\n\n' +
              '**💰 Minha loja:**\n' +
              '`.instrutorl loja`\n\n' +
              '**📚 Tipos disponíveis:**\n' +
              '**teamcombo** - Team Combo (5pts)\n' +
              '**movimentacao** - Movimentação (3pts)\n' +
              '**combos** - Combos de Armas (5pts)\n' +
              '**positioning** - Posicionamento (2pts)\n' +
              '**reading** - Leitura de Jogo (1pt)\n' +
              '**strategy** - Estratégia (6pts)\n' +
              '**advanced** - Técnica Avançada (8pts)'
            );
            return message.reply({ embeds: [embed] });
          }

          const action = args[0].toLowerCase();
          const instructorId = message.author.id;

          switch (action) {
            case 'iniciar':
            case 'start':
              if (args.length < 4) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutorl iniciar [tipo] [aluno] [duração]`')]
                });
              }

              const [startType, startStudentId, startDuration] = args.slice(1);
              const startScoreTypes = getScoreTypes();
              const startScoreType = startScoreTypes[startType];
              
              if (!startScoreType) {
                return message.reply({
                  embeds: [createErrorEmbed('Tipo Inválido', 'Tipo de treinamento não encontrado. Use `.instrutorl` para ver os tipos disponíveis.')]
                });
              }

              const startStudent = await guild.members.fetch(startStudentId).catch(() => null);
              if (!startStudent) {
                return message.reply({
                  embeds: [createErrorEmbed('Aluno Não Encontrado', 'Não foi possível encontrar o aluno na guild.')]
                });
              }

              // Create training session
              const startSession = addTrainingSession(
                instructorId,
                startStudentId,
                startType,
                startDuration,
                0, // No points yet
                `Sessão iniciada via instrutorl`,
                'active' // Active status
              );

              const startEmbed = createSuccessEmbed(
                '🎓 Treinamento Iniciado',
                `**Instrutor:** ${message.author.tag}\n**Aluno:** ${startStudent.user.tag}\n**Tipo:** ${startScoreType.name}\n**Duração:** ${startDuration}\n**ID da Sessão:** \`${startSession.id}\`\n\nUse \`.instrutorl finalizar ${startSession.id} [pontos]\` para concluir.`
              );

              await message.reply({ embeds: [startEmbed] });

              // Send start message to student
              if (startStudent.id !== instructorId) {
                try {
                  const startMsg = formatTrainingMessage(
                    getScoreTypes().training_messages.start,
                    {
                      instructor: message.author.tag,
                      student: startStudent.user.tag,
                      type: startScoreType.name,
                      duration: startDuration,
                      description: 'Treinamento iniciado'
                    }
                  );

                  await startStudent.send({
                    embeds: [new EmbedBuilder()
                      .setColor(0xfaa61a)
                      .setTitle('🎓 Treinamento Iniciado!')
                      .setDescription(startMsg)]
                  });
                } catch (err) {
                  console.log('Error sending training start message:', err);
                }
              }
              break;

            case 'finalizar':
            case 'finish':
              if (args.length < 3) {
                return message.reply({
                  embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.instrutorl finalizar [ID] [pontos]`')]
                });
              }

              const [finishSessionId, finishPoints] = args.slice(1);
              const finishData = readTrainingData();
              const finishSession = finishData.training_sessions.find(s => s.id === finishSessionId);
              
              if (!finishSession) {
                return message.reply({
                  embeds: [createErrorEmbed('Sessão Não Encontrada', 'ID da sessão não encontrado.')]
                });
              }

              if (finishSession.status === 'complete') {
                return message.reply({
                  embeds: [createErrorEmbed('Sessão Já Concluída', 'Esta sessão já foi concluída anteriormente.')]
                });
              }

              const finishParsedPoints = parseInt(finishPoints);
              if (isNaN(finishParsedPoints) || finishParsedPoints <= 0) {
                return message.reply({
                  embeds: [createErrorEmbed('Pontos Inválidos', 'Os pontos devem ser um número maior que zero.')]
                });
              }

              const finishScoreTypes = getScoreTypes();
              const finishScoreType = finishScoreTypes[finishSession.type];
              const finishActualPoints = finishParsedPoints * finishScoreType.base_points * finishScoreType.multiplier;

              // Update session with points and mark as complete
              finishSession.points = finishActualPoints;
              finishSession.notes = `Concluído via instrutorl - ${finishParsedPoints} pontos base`;
              finishSession.status = 'complete';

              // Update scores
              if (!finishData.student_scores[finishSession.student_id]) {
                finishData.student_scores[finishSession.student_id] = {};
              }
              if (!finishData.student_scores[finishSession.student_id][finishSession.type]) {
                finishData.student_scores[finishSession.student_id][finishSession.type] = 0;
              }
              finishData.student_scores[finishSession.student_id][finishSession.type] += finishActualPoints;

              if (!finishData.instructor_scores[finishSession.instructor_id]) {
                finishData.instructor_scores[finishSession.instructor_id] = {};
              }
              if (!finishData.instructor_scores[finishSession.instructor_id][finishSession.type]) {
                finishData.instructor_scores[finishSession.instructor_id][finishSession.type] = 0;
              }
              finishData.instructor_scores[finishSession.instructor_id][finishSession.type] += finishActualPoints;

              updateLeaderboards(finishData);
              writeTrainingData(finishData);

              // Track points for role holders (instructor role 1461134737505652806)
              const instructorMember = await guild.members.fetch(finishSession.instructor_id).catch(() => null);
              if (instructorMember && hasInstructorRole(instructorMember, '1461134737505652806')) {
                addRoleHolderPoints(finishSession.instructor_id, finishActualPoints, finishSession.type);
              }

              const finishEmbed = createSuccessEmbed(
                '🎯 Treinamento Concluído',
                `**Sessão ID:** ${finishSessionId}\n**Aluno:** <@${finishSession.student_id}>\n**Tipo:** ${finishScoreType.name}\n**Pontos ganhos:** ${finishActualPoints}\n**Observações:** ${finishSession.notes}`
              );

              await message.reply({ embeds: [finishEmbed] });
              break;

            case 'stats':
            case 'estatisticas':
              const statsInstructorPoints = calculateTotalScore(instructorId, true);
              const statsStudentPoints = calculateTotalScore(instructorId, false);
              const statsSessions = getInstructorSessions(instructorId, 5);

              const statsEmbed = createSuccessEmbed(
                '📊 Minhas Estatísticas',
                `**Pontos como Instrutor:** ${statsInstructorPoints}\n**Pontos como Aluno:** ${statsStudentPoints}\n**Total de Sessões:** ${statsSessions.length}\n\n**Últimas sessões:**\n` +
                (statsSessions.length > 0 
                  ? statsSessions.slice(0, 3).map((s, i) => 
                      `${i + 1}. ${s.status === 'complete' ? '✅' : '🔄'} <@${s.student_id}> - ${getScoreTypes()[s.type]?.name || s.type}`
                    ).join('\n')
                  : 'Nenhuma sessão ainda'
                )
              );

              await message.reply({ embeds: [statsEmbed] });
              break;

            case 'top':
            case 'ranking':
              const topInstructors = getInstructorLeaderboard();
              
              const topEmbed = new EmbedBuilder()
                .setColor(0xfaa61a)
                .setTitle('🏆 Top Instrutores')
                .setDescription(topInstructors.slice(0, 5).map((entry, index) => {
                  return `**${index + 1}.** <@${entry.instructor_id}> - **${entry.total_points} pontos**`;
                }).join('\n\n'))
                .setFooter({ text: 'Ranking atualizado automaticamente' })
                .setTimestamp();

              await message.reply({ embeds: [topEmbed] });
              break;

            case 'loja':
            case 'shop':
              const shopItems = getShopItems();
              const userPoints = calculateTotalScore(message.author.id, false);
              
              const shopEmbed = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('🛍 Loja de Recompensas')
                .setDescription(`Você tem **${userPoints} pontos** disponíveis.\n\nUse \`.resgatar [ID]\` para comprar itens.`)
                .setTimestamp();

              // Group items by category
              const shopByCategory = {};
              shopItems.forEach(item => {
                if (!shopByCategory[item.category]) {
                  shopByCategory[item.category] = [];
                }
                shopByCategory[item.category].push(item);
              });

              Object.entries(shopByCategory).forEach(([cat, items]) => {
                const categoryEmoji = {
                  'Cosmética': '✨',
                  'Funcional': '⚙️',
                  'Status': '👑'
                }[cat] || '📦';

                const itemsList = items.slice(0, 3).map(item => {
                  const canAfford = userPoints >= item.cost;
                  const status = canAfford ? '✅' : '❌';
                  return `${status} **${item.id}** - ${item.name} (${item.cost}pts)`;
                }).join('\n');

                shopEmbed.addFields({
                  name: `${categoryEmoji} ${cat}`,
                  value: itemsList + (items.length > 3 ? '\n...e mais!' : ''),
                  inline: false
                });
              });

              await message.reply({ embeds: [shopEmbed] });
              break;

            default:
              return message.reply({
                embeds: [createErrorEmbed('Ação Inválida', 'Ação não reconhecida. Use `.instrutorl` para ver as ações disponíveis.')]
              });
          }

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro no Comando', err.message)]
          });
        }
      }

    } catch (err) {
      console.error('[Command Error]', err);
      await message.reply({ embeds: [createErrorEmbed('Erro Interno', `Um erro inesperado ocorreu: ${err.message}`)] }).catch(() => {});
    }
  });

  // task com periodo
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
        .setDescription(`Olá! Vocês estão marcados como inativos
          Se você está nesta lista, significa que fez menos de 500 de contribuição na semana passada. 
          Para saber como contribuir, veja o canal <#${'1465513473583616011'}> ou fale com um membro da staff.
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
      console.log(`[Inactive Reminder] Sent message with ${inactivePlayers.length} inactive players`);
    } catch (err) {
      console.error('[Inactive Reminder Error]', err);
    }
  }

  // Setup periodic task (runs every 3 hours by default, or interval as configured)
  if (inactivePlayersConfig.channelId) {
    const interval = parseInt(inactivePlayersConfig.messageInterval) || 10800000; // 3 hours default
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
