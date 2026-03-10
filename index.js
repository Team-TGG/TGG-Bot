import 'dotenv/config';
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder, ButtonBuilder } from 'discord.js';
import { getUsers, getUsersWithElo, addInactivePlayer, removeInactivePlayer, getInactivePlayers, getWeeklyMissions, addUser, deleteUser, deactivateUser, reactivateOrAddUser, getClient } from './src/db.js';
import { addWarning, getWarningCount, getUserWarnings, clearWarnings, removeWarning, parseTime, formatTime } from './src/moderation.js';
import { 
  getScoreTypes, 
  addTrainingSession, 
  getInstructorSessions, 
  getStudentSessions,
  claimStudent,
  unclaimStudent,
  getInstructorStudents,
  getStudentInstructor
} from './src/training_db.js';
import { 
  getInstructorLeaderboard, 
  getStudentLeaderboard, 
  calculateTotalScore, 
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
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig } from './config/index.js';
import { getUserByDiscordId } from './src/db.js';
import { startCronJobs } from './src/scheduler/cron.js';

const TRAINING_TYPE_ALIASES = {
  'teamcombo': 'follow-up_/_team_combo',
  'combo': 'follow-up_/_team_combo',
  'team': 'follow-up_/_team_combo',
  'followup': 'follow-up_/_team_combo',
  'follow': 'follow-up_/_team_combo',
  'mov': 'aula_de_movimentação',
  'movimentacao': 'aula_de_movimentação',
  'aula': 'aula_de_movimentação',
  'replay': 'análise_de_replay',
  'analise': 'análise_de_replay',
  'treino': 'treino_completo',
  'completo': 'treino_completo',
  'tc': 'treino_completo',
  'full': 'treino_completo',
  'arma': 'fundamentos_da_arma',
  'fundamentos': 'fundamentos_da_arma',
  'habitos': 'correção_de_hábitos',
  'correcao': 'correção_de_hábitos',
  'platina': 'aluno_chegou_à_platina',
  'diamante': 'aluno_chegou_ao_diamante',
  'acompanhamento': 'acompanhamento_contínuo',
  'continuo': 'acompanhamento_contínuo'
};

async function main() {
  if (!discordConfig.token || !discordConfig.guildId) {
    console.error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env');
    process.exit(1);
  }

  const client = createClient();
  const PREFIX = '.';

async function sendCleanMessage(originalMessage, newEmbed) {
  try {
    await originalMessage.delete();
    return await originalMessage.channel.send({ embeds: [newEmbed] });
  } catch (err) {
    return await originalMessage.reply({ embeds: [newEmbed] });
  }
}
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
    'unwarn': 'unwarn',
    'warns': 'warns',
    'warnings': 'warns',
    'mute': 'mute',
    'unmute': 'unmute',
    'ban': 'ban',
    'pontos': 'pontos',
    'instrutor': 'instrutor',
    'instrutorl': 'instrutorl',
    'loja': 'shop',
    'lj': 'shop',
    'shop': 'shop',
    'resgatar': 'buy',
    'buy': 'buy',
    'comprar': 'buy',
    'claim': 'claim',
    'reivindicar': 'claim',
    'unclaim': 'unclaim',
    'desreivindicar': 'unclaim',
  };

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
    entrou: '<:cima:1475807892782317578>',
    saiu: '<:baixo:1475807866714718239>',
    success: '<:check:1475806856722120838>',
    warning: '<:warning:1475807305794949182>',
    error: '<:xis:1475807109554896966>',
    ponto: '<:ponto:1475807354197819453>',
    castle: '🏰',
    refresh: '🔄',
    book: '📖',
    gear: '⚙️',
    sleep: '😴',
    hammer: '🔨',
    graduation: '🎓',
    crossedSwords: '⚔️',
    hourglass: '⏳'
  };

  client.once('clientReady', async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    startCronJobs(client, {
      fetchBrawlhallaClanData,
      runSync,
      runEloSync,
      syncNicknames,
      getUsers,
      getUsersWithElo
    });
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
    try {
      // Ignorar mensagens de bots e mensagens que não começam com .
      if (message.author.bot || !message.content.startsWith('.')) {
        return;
      }

      const args = message.content.slice(1).split(/ +/);
      const commandName = args.shift().toLowerCase();
      const command = COMMAND_ALIASES[commandName] || commandName;

      // ---- .help ----
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
            { name: `${EMOJIS.arrowRight} .entrou <@user> <bhid> (admin)`, value: 'Adicionar novo usuário ou reativar existente no banco de dados', inline: false },
            { name: `${EMOJIS.arrowRight} .saiu <@user|@discord_id|bhid> (admin)`, value: 'Desativar usuário do banco de dados (não exclui permanentemente)', inline: false }
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
            { name: `${EMOJIS.arrowRight} .warn <@user> [reason] (admin)`, value: 'Adicionar aviso ao usuário (2 warns=mute, 3 warns=ban)', inline: false },
            { name: `${EMOJIS.arrowRight} .warns [page] (admin)`, value: 'Listar avisos dos usuários (10 por página)', inline: false },
            { name: `${EMOJIS.arrowRight} .unwarn <@user> [number] (admin)`, value: 'Remover aviso específico do usuário', inline: false },
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
            { name: `${EMOJIS.arrowRight} .claim <@user|user_id> [instructor2]`, value: 'Reivindicar aluno (múltiplos instrutores permitidos)', inline: false },
            { name: `${EMOJIS.arrowRight} .unclaim <@user|user_id>`, value: 'Remover sua reivindicação de aluno', inline: false },
            { name: `${EMOJIS.arrowRight} .pontos [tipo] [aluno] [obs]`, value: 'Adicionar pontos automaticamente baseados no tipo de treinamento', inline: false },
            { name: `${EMOJIS.arrowRight} .instrutor ranking`, value: 'Ver o ranking dos instrutores mais ativos', inline: false },
            { name: `${EMOJIS.arrowRight} .instrutor [comando]`, value: 'Sistema simplificado (pontos, sessao, concluir, parcial, historico, ranking, tipos)', inline: false },
            { name: `${EMOJIS.arrowRight} .shop [categoria]`, value: 'Ver loja de recompensas com menu interativo\n**Abreviações:** .shop cos, .shop func, .shop stat', inline: false },
            { name: `${EMOJIS.arrowRight} .buy [ID]`, value: 'Comprar item da loja usando pontos', inline: false }
          )
          .setFooter({ text: 'Selecione uma categoria no dropdown' })
          .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('help_menu')
          .setPlaceholder('Escolha uma categoria...')
          .addOptions(
            { label: 'Guilda', value: 'guild', emoji: EMOJIS.castle, description: 'Comandos da guilda' },
            { label: 'Sincronização', value: 'sync', emoji: EMOJIS.refresh, description: 'Comandos de sincronização' },
            { label: 'Informações', value: 'info', emoji: EMOJIS.book, description: 'Comandos de informação' },
            { label: 'Gerenciamento', value: 'users', emoji: EMOJIS.gear, description: 'Gerenciamento de usuários' },
            { label: 'Inativos', value: 'inac', emoji: EMOJIS.sleep, description: 'Comandos de inatividade' },
            { label: 'Moderação', value: 'mod', emoji: EMOJIS.hammer, description: 'Comandos de moderação' },
            { label: 'Treinamento', value: 'training', emoji: EMOJIS.graduation, description: 'Sistema de treinamento' }
          );

        const backButton = new ButtonBuilder()
          .setCustomId('help_back')
          .setLabel('Voltar')
          .setStyle(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const rowWithBack = new ActionRowBuilder().addComponents(backButton);
        
        const helpMsg = await message.reply({ embeds: [page1], components: [row] });

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
            await interaction.update({ embeds: [embedToShow], components: [row, rowWithBack] });
          } else if (interaction.customId === 'help_back') {
            await interaction.update({ embeds: [page1], components: [row] });
          }
        });

        collector.on('end', () => {
          helpMsg.delete().catch(() => {});
        });
      }

      // ---- .guild-activity ----
      if (command === 'guild-activity') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        const loadingEmbed = new EmbedBuilder()
          .setColor(0xfaa61a)
          .setTitle(`${EMOJIS.loading} Sincronizando...`)
          .setDescription('Buscando atividade da guild...');
        
        const loadingMsg = await message.reply({ embeds: [loadingEmbed] });
        
        try {
          const result = await runAndPostGuildActivity(client);
          if (result.ok) {
            const summary = result.summary || {};
            const resultEmbed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle(`${EMOJIS.check} Atividade Sincronizada`)
              .setDescription(`Atividade da guild atualizada com sucesso.`)
              .addFields(
                { name: '📊 Total de Membros', value: `${summary.total_members || 0}`, inline: true },
                { name: '👥 Membros Online', value: `${summary.online_members || 0}`, inline: true },
                { name: '💬 Mensagens', value: `${summary.messages || 0}`, inline: true }
              )
              .setTimestamp();
            
            await sendCleanMessage(loadingMsg, resultEmbed);
          } else {
            await sendCleanMessage(loadingMsg, createErrorEmbed('Erro na Sincronização', result.error));
          }
        } catch (err) {
          await sendCleanMessage(loadingMsg, createErrorEmbed('Erro na Sincronização', err.message));
        }
      }

      // ---- .movimentacao / .mov ----
      if (command === 'movimentacao' || command === 'mov') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        const loadingEmbed = new EmbedBuilder()
          .setColor(0xfaa61a)
          .setTitle(`${EMOJIS.loading} Carregando...`)
          .setDescription('Buscando dados de movimentação...');
        
        const loadingMsg = await message.reply({ embeds: [loadingEmbed] });
        
        try {
          let startDate, endDate, queryType = 'range';
          
          if (args.length >= 3) {
            startDate = args[1];
            endDate = args[2];
            if (!isValidDate(startDate) || !isValidDate(endDate)) {
              return await sendCleanMessage(loadingMsg, createErrorEmbed('Data Inválida', 'Formato: YYYY-MM-DD'));
            }
            queryType = 'range';
          } else if (args.length === 2) {
            startDate = args[1];
            if (!isValidDate(startDate)) {
              return await sendCleanMessage(loadingMsg, createErrorEmbed('Data Inválida', 'Formato: YYYY-MM-DD'));
            }
            endDate = startDate;
            queryType = 'day';
          } else {
            const range = getDefaultDateRange();
            startDate = range.startDate;
            endDate = range.endDate;
            queryType = 'range';
          }
          
          const data = await fetchMovimentacao({ date: queryType === 'day' ? startDate : null, startDate: queryType === 'range' ? startDate : null, endDate: queryType === 'range' ? endDate : null });
          const result = buildMovimentacaoEmbeds(data.data || [], startDate, endDate);
          
          if (result.needsFile) {
            const textContent = formatMovimentacaoAsText(result.json);
            const attachment = new AttachmentBuilder(Buffer.from(textContent), {
              name: `movimentacao_${startDate}_${endDate}.txt`,
            });
            const dateDisplay = startDate === endDate ? startDate : `${startDate} a ${endDate}`;
            const fileEmbed = new EmbedBuilder()
                  .setColor(0xfaa61a)
                  .setTitle(`${EMOJIS.ponto} Guild Movimentação (Arquivo)`)
                  .setDescription(`Dados de ${dateDisplay}\nOs dados foram salvos em arquivo de texto pois ultrapassaram o limite de tamanho.`)
                  .addFields([
                    { name: 'Entradas', value: String(result.json.summary.entrou), inline: true },
                    { name: 'Saídas', value: String(result.json.summary.saiu), inline: true },
                    { name: 'Total', value: String(result.json.summary.total), inline: true },
                    { name: 'Promoções', value: String(result.json.summary.promovido), inline: true },
                    { name: 'Rebaixamentos', value: String(result.json.summary.rebaixado), inline: true },
                  ])
                  .setFooter({ text: `Período: ${dateDisplay}` })
                  .setTimestamp();
            
            await sendCleanMessage(loadingMsg, fileEmbed, [attachment]);
          } else {
            const EMBEDS_PER_MESSAGE = 10;
            for (let i = 0; i < result.embeds.length; i += EMBEDS_PER_MESSAGE) {
              const chunk = result.embeds.slice(i, i + EMBEDS_PER_MESSAGE);
              if (i === 0) {
                await sendCleanMessage(loadingMsg, chunk);
              } else {
                await message.channel.send({ embeds: chunk });
              }
            }
          }
        } catch (err) {
          await sendCleanMessage(loadingMsg, createErrorEmbed('Erro na API', err.message));
        }
      }

      // ---- .sync ----
      if (command === 'sync') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        const loadingEmbed = new EmbedBuilder()
          .setColor(0xfaa61a)
          .setTitle(`${EMOJIS.loading} Sincronizando...`)
          .setDescription('Executando sincronização completa...');
        
        const loadingMsg = await message.reply({ embeds: [loadingEmbed] });
        
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
            
          await sendCleanMessage(loadingMsg, resultEmbed);
        } catch (err) {
          await sendCleanMessage(loadingMsg, createErrorEmbed('Erro de Sincronização', err.message));
        }
      }

      // ---- .sync-nicknames / .sync-nick ----
      if (command === 'sync-nicknames' || command === 'sync-nick') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
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

      // ---- .refresh-clan-cache / .refresh-cache ----
      if (command === 'refresh-clan-cache' || command === 'refresh-cache') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        const loading = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`${EMOJIS.loading} Atualizando...`).setDescription('Atualizando cache do clan Brawlhalla...')] });
        try {
          const clanData = await fetchBrawlhallaClanData();
          await message.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`${EMOJIS.check} Cache Atualizado`).setDescription(`${clanData.clan?.length || 0} membros`).addFields({ name: 'Clan', value: `${clanData.clan_name} (${clanData.clan_id})`, inline: true }).setTimestamp()] });
          await loading.delete();
        } catch (err) {
          await loading.edit({ embeds: [createErrorEmbed('Erro ao Atualizar Cache', err.message)] });
        }
      }

      // ---- .active ----
      if (command === 'active') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const inactiveRoleId = inactivePlayersConfig.inactiveRoleId;

          let targetId;
          let note;

          const mentionMatch = message.content.match(/<@!?(\d+)>/);

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

          if (await isAdmin(message.author.id) && mentionMatch) {
            targetId = mentionMatch[1];

            const afterMention = message.content.split('>').slice(1).join('>').trim();
            note = afterMention.length > 0 ? afterMention : 'ativado por administrador';
          } else {
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

          if (member.roles.cache.has(inactiveRoleId)) {
            await member.roles.remove(inactiveRoleId);
          }

          await removeInactivePlayer(targetId, note);

          const embed = createSuccessEmbed(
            'Ativado',
            `${member.user.tag} foi marcado como ativo.\nMotivo: ${note}`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          if (err.message.includes('já está ativo')) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Já está ativo',
                  'Este usuário já está marcado como ativo nesta semana.'
                )
              ]
            });
          }          if (err.message.includes('não está marcado como inativo')) {
            return message.reply({
              embeds: [
                createErrorEmbed(
                  'Não está inativo',
                  'Este usuário não está marcado como inativo nesta semana.'
                )
              ]
            });
          }

          await message.reply({
            embeds: [createErrorEmbed('Erro ao Ativar Usuário', err.message)]
          });
        }
      }

      // ---- .regras ----
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

      // ---- .inac-all ----
      if (command === 'inac-all') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
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

      // ---- .inac-list ----
      if (command === 'inac-list') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
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

      // ---- .missoes ----
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

      // ---- .entrou ----
      if (command === 'entrou') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (!mentionMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.entrou <@user> <brawlhalla_id>`')]
            });
          }

          const targetId = mentionMatch[1];
          const brawlhallaId = args[1];

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
      }

      // ---- .saiu ----
      if (command === 'saiu') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.saiu <@user|@discord_id|brawlhalla_id>`')]
            });
          }

          const identifier = args[0];
          let deactivatedUser;
          let member = null;
          let actualIdentifier = identifier;

          if (identifier.startsWith('<@') && identifier.endsWith('>')) {            const mentionMatch = identifier.match(/<@!?(\d+)>/);
            if (mentionMatch) {
              actualIdentifier = mentionMatch[1];
              member = await guild.members.fetch(actualIdentifier).catch(() => null);
            }
          } else if (identifier.startsWith('@')) {
            actualIdentifier = identifier.slice(1);
            member = await guild.members.fetch(actualIdentifier).catch(() => null);
          } else {
          }          const dbIdentifier = (identifier.startsWith('<@') || identifier.startsWith('@')) ? `@${actualIdentifier}` : actualIdentifier;
          deactivatedUser = await deactivateUser(dbIdentifier);          if (member) {
            const recruitRoles = ['1437441679572471940', '1437427750209327297'];
            for (const roleId of recruitRoles) {
              if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
              }
            }
          }

          const embed = createSuccessEmbed(
            'Usuário Desativado',
            `**Usuário:** ${deactivatedUser.username}\n**Discord ID:** ${deactivatedUser.discord_id}\n**Brawlhalla ID:** ${deactivatedUser.brawlhalla_id}\n\nUsuário desativado no banco de dados com sucesso!${member ? '\nCargos de recruit removidos.' : ''}`
          );

          await message.reply({ embeds: [embed] });

        } catch (err) {
          if (err.message.includes('não encontrado')) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', err.message)]
            });
          }

          await message.reply({
            embeds: [createErrorEmbed('Erro ao Desativar Usuário', err.message)]
          });
        }
      }

      // ---- .warn ----
      if (command === 'warn') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
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

          const warningCount = await addWarning(targetId, message.author.id, reason);

          const embed = createSuccessEmbed(
            'Aviso Adicionado',
            `${member.user.tag} recebeu um aviso.\n**Motivo:** ${reason}\n**Total de avisos:** ${warningCount}/3`
          );

          await message.reply({ embeds: [embed] });

          if (warningCount === 2) {
            // Mute automático após 2 avisos
            const muteRole = guild.roles.cache.find(r => r.name === 'Muted');
            if (muteRole) {
              await member.roles.add(muteRole);
              setTimeout(() => {
                member.roles.remove(muteRole).catch(() => {});
              }, 15 * 60 * 1000);
              
              await message.channel.send({
                embeds: [new EmbedBuilder()
                  .setColor(0xfaa61a)
                  .setTitle('⚠️ Mute')
                  .setDescription(`${member.user.tag} foi silenciado por 15 minutos devido a 2 avisos.`)]
              });
            }
          } else if (warningCount >= 3) {
            // Ban automático após 3 avisos
            await member.ban({ reason: '3 avisos acumulados' });
            await message.channel.send({
              embeds: [new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('🔨 Ban')
                .setDescription(`${member.user.tag} foi banido devido a 3 avisos acumulados.`)]
            });
          }

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Adicionar Aviso', err.message)]
          });
        }
      }

      // ---- .unwarn ----
      if (command === 'unwarn') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const mentionMatch = message.content.match(/<@!?(\d+)>/);
          if (!mentionMatch) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unwarn <@user> [número]`')]
            });
          }

          const targetId = mentionMatch[1];
          const member = await guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return message.reply({
              embeds: [createErrorEmbed('Usuário Não Encontrado', 'Não foi possível encontrar o usuário na guild.')]
            });
          }

          // Se não especificou número, mostra lista de avisos
          const warningNumber = args[1] ? parseInt(args[1]) : null;
          
          if (!warningNumber) {
            const warnings = await getUserWarnings(targetId);
            if (warnings.length === 0) {
              return message.reply({
                embeds: [createErrorEmbed('Sem Avisos', 'Este usuário não possui avisos.')]
              });
            }

            const warningList = warnings.map((w, index) => 
              `**${w.warning_number}.** ${w.reason}\n   • Por: <@${w.moderator_id}>\n   • Data: ${new Date(w.created_at).toLocaleDateString('pt-BR')}`
            ).join('\n\n');

            const embed = new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle(`⚠️ Avisos de ${member.user.tag}`)
              .setDescription(`**Total:** ${warnings.length} avisos\n\n${warningList}`)
              .setFooter({ text: 'Use .unwarn <@user> [número] para remover um aviso específico' })
              .setTimestamp();

            return message.reply({ embeds: [embed] });
          }

          // Remove aviso específico
          try {
            await removeWarning(targetId, warningNumber);
            
            const embed = createSuccessEmbed(
              'Aviso Removido',
              `Aviso **${warningNumber}** de ${member.user.tag} foi removido com sucesso.`
            );

            await message.reply({ embeds: [embed] });
          } catch (err) {
            return message.reply({
              embeds: [createErrorEmbed('Erro ao Remover', 'Não foi possível encontrar este aviso. Verifique o número e tente novamente.')]
            });
          }

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Remover Aviso', err.message)]
          });
        }
      }

      // ---- .warns ----
      if (command === 'warns') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
        try {
          const page = parseInt(args[0]) || 1;
          const pageSize = 10;
          
          // Get all users with warnings from database
          const client = getClient();
          const { data: allWarnings, error } = await client
            .from('warnings')
            .select('*')
            .order('created_at', { ascending: false });
          
          if (error) throw error;
          
          if (!allWarnings || allWarnings.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Sem Avisos', 'Nenhum aviso encontrado no sistema.')]
            });
          }
          
          // Group warnings by user
          const warningsByUser = {};
          allWarnings.forEach(warning => {
            if (!warningsByUser[warning.user_id]) {
              warningsByUser[warning.user_id] = {
                user_id: warning.user_id,
                warnings: [],
                latest_warning: warning.created_at
              };
            }
            warningsByUser[warning.user_id].warnings.push(warning);
            if (new Date(warning.created_at) > new Date(warningsByUser[warning.user_id].latest_warning)) {
              warningsByUser[warning.user_id].latest_warning = warning.created_at;
            }
          });
          
          // Sort users by latest warning
          const sortedUsers = Object.values(warningsByUser)
            .sort((a, b) => new Date(b.latest_warning) - new Date(a.latest_warning));
          
          // Paginate
          const totalPages = Math.ceil(sortedUsers.length / pageSize);
          const offset = (page - 1) * pageSize;
          const startIndex = offset;
          const endIndex = Math.min(startIndex + pageSize, sortedUsers.length);
          const pageUsers = sortedUsers.slice(startIndex, endIndex);
          
          if (pageUsers.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Página Inválida', `Página ${page} não existe. Total de páginas: ${totalPages || 1}`)]
            });
          }
          
          // Build embed
          const embed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle(`⚠️ Lista de Avisos (Página ${page}/${totalPages})`)
            .setDescription(`Mostrando ${pageUsers.length} usuários com avisos`)
            .setTimestamp();
          
          for (const userData of pageUsers) {
            const user = await client.users.fetch(userData.user_id).catch(() => null);
            const userName = user?.tag || `Usuário ${userData.user_id}`;
            const warningCount = userData.warnings.length;
            const latestWarning = new Date(userData.latest_warning).toLocaleDateString('pt-BR');
            
            embed.addFields({
              name: `${warningCount} avisos - ${userName}`,
              value: `**ID:** ${userData.user_id}\n**Último aviso:** ${latestWarning}\n**Avisos recentes:** ${userData.warnings.slice(0, 2).map(w => `• ${w.reason}`).join('\n')}`,
              inline: false
            });
          }
          
          embed.setFooter({ 
            text: `Total de usuários com avisos: ${sortedUsers.length}` 
          });
          
          // Create pagination buttons
          const row = new ActionRowBuilder();
          
          if (page > 1) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`warns_page_${page - 1}`)
                .setLabel('⬅️ Anterior')
                .setStyle('Secondary')
            );
          }
          
          row.addComponents(
            new ButtonBuilder()
              .setLabel(`📄 ${page}/${totalPages}`)
              .setStyle('Secondary')
              .setDisabled(true)
          );
          
          if (page < totalPages) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`warns_page_${page + 1}`)
                .setLabel('➡️ Próxima')
                .setStyle('Secondary')
            );
          }
          
          const components = row.components.length > 0 ? [row] : [];
          
          const messageReply = await message.reply({ embeds: [embed], components });
          
          // Create collector for button interactions
          const collector = messageReply.createMessageComponentCollector({
            time: 60000 // 60 seconds
          });
          
          collector.on('collect', async (interaction) => {
            if (!interaction.isButton()) return;
            
            const newPage = parseInt(interaction.customId.split('_')[2]);
            
            // Update the embed with new page
            const newOffset = (newPage - 1) * pageSize;
            const newStartIndex = newOffset;
            const newEndIndex = Math.min(newStartIndex + pageSize, sortedUsers.length);
            const newPageUsers = sortedUsers.slice(newStartIndex, newEndIndex);
            
            const newEmbed = new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle(`⚠️ Lista de Avisos (Página ${newPage}/${totalPages})`)
              .setDescription(`Mostrando ${newPageUsers.length} usuários com avisos`)
              .setTimestamp();
            
            for (const userData of newPageUsers) {
              const user = await client.users.fetch(userData.user_id).catch(() => null);
              const userName = user?.tag || `Usuário ${userData.user_id}`;
              const warningCount = userData.warnings.length;
              const latestWarning = new Date(userData.latest_warning).toLocaleDateString('pt-BR');
              
              newEmbed.addFields({
                name: `${warningCount} avisos - ${userName}`,
                value: `**ID:** ${userData.user_id}\n**Último aviso:** ${latestWarning}\n**Avisos recentes:** ${userData.warnings.slice(0, 2).map(w => `• ${w.reason}`).join('\n')}`,
                inline: false
              });
            }
            
            newEmbed.setFooter({ 
              text: `Total de usuários com avisos: ${sortedUsers.length}` 
            });
            
            // Create new buttons
            const newRow = new ActionRowBuilder();
            
            if (newPage > 1) {
              newRow.addComponents(
                new ButtonBuilder()
                  .setCustomId(`warns_page_${newPage - 1}`)
                  .setLabel('⬅️ Anterior')
                  .setStyle('Secondary')
              );
            }
            
            newRow.addComponents(
              new ButtonBuilder()
                .setLabel(`📄 ${newPage}/${totalPages}`)
                .setStyle('Secondary')
                .setDisabled(true)
            );
            
            if (newPage < totalPages) {
              newRow.addComponents(
                new ButtonBuilder()
                  .setCustomId(`warns_page_${newPage + 1}`)
                  .setLabel('➡️ Próxima')
                  .setStyle('Secondary')
              );
            }
            
            const newComponents = newRow.components.length > 0 ? [newRow] : [];
            
            await interaction.update({ embeds: [newEmbed], components: newComponents });
          });
          
          collector.on('end', () => {
            messageReply.edit({ components: [] }).catch(() => {});
          });
          
        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Listar Avisos', err.message)]
          });
        }
      }

      // ---- .mute ----
      if (command === 'mute') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
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

          let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
          if (!muteRole) {
            muteRole = await guild.roles.create({
              name: 'Muted',
              color: 0x808080,
              reason: 'Cargo para usuários silenciados'
            });
          }

          if (member.voice.channel) {
            await member.voice.setMute(true, 'Usuário silenciado por moderação');
          }

          await member.roles.add(muteRole);

          const embed = createSuccessEmbed(
            'Usuário Silenciado',
            `${member.user.tag} foi silenciado por ${formatTime(durationMs)}.\n**Voice mute:** ${member.voice.channel ? 'Sim' : 'Não'}`
          );

          await message.reply({ embeds: [embed] });

          const muteInfo = {
            userId: targetId,
            endTime: Date.now() + durationMs,
            wasInVoice: !!member.voice.channel,
            originalVoiceState: member.voice.serverMute
          };

          setTimeout(async () => {
            try {
              const guild = client.guilds.cache.get(discordConfig.guildId);
              const user = await guild.members.fetch(targetId).catch(() => null);
              
              if (user && user.roles.cache.has(muteRole.id)) {
                await user.roles.remove(muteRole);
                
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

      // ---- .ban ----
      if (command === 'ban') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
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

      // ---- .unmute ----
      if (command === 'unmute') {
        if (!(await isAdmin(message.author.id))) {
          return message.reply({
            embeds: [createErrorEmbed('Acesso Negado', 'Apenas administradores podem usar este comando.')]
          });
        }
        
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

          await member.roles.remove(muteRole);

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

      // ---- .pontos ----
      if (command === 'pontos') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          const instructorRoleId = '1461134737505652806';
          
          const member = await guild.members.fetch(message.author.id).catch(() => null);
          const isAdminUser = await isAdmin(message.author.id);
          const hasInstructorAccess = member && (
            hasInstructorRole(member, instructorRoleId) || 
            isAdminUser
          );
          
          if (!hasInstructorAccess) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Apenas usuários com cargo de instrutor (ou administradores) podem usar este comando.')]
            });
          }

          if (args.length < 2) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 
                `Uso: \`.pontos [tipo] [aluno] [observações]\`\n\n**Tipos mais usados:**\n• teamcombo (Follow-up)\n• mov (Movimentação)\n• replay (Análise)\n• treino (Completo)\n• arma (Fundamentos)\n\nUse \`.instrutor tipos\` para ver todos.`)]
            });
          }

          const [type, studentIdentifier, ...notes] = args;
          const scoreTypes = await getScoreTypes();
          const resolvedType = TRAINING_TYPE_ALIASES[type] || type;
          const scoreType = scoreTypes[resolvedType];
          
          if (!scoreType) {
            console.log(`[DEBUG] type: ${type}, resolvedType: ${resolvedType}, scoreTypes keys:`, Object.keys(scoreTypes));
            return message.reply({
              embeds: [createErrorEmbed('Tipo Inválido', 
                `Tipo "${type}" não encontrado.\n\nUse \`.instrutor tipos\` para ver os tipos disponíveis.`)]
            });
          }

          let student;
          
          if (studentIdentifier.startsWith('<@') || studentIdentifier.startsWith('<!')) {
            const userId = studentIdentifier.replace(/[<@!>]/g, '');
            student = await guild.members.fetch(userId).catch(() => null);
          } else {
            const cleanIdentifier = studentIdentifier.replace(/^@/, '');
            
            if (/^\d+$/.test(cleanIdentifier)) {
              student = await guild.members.fetch(cleanIdentifier).catch(() => null);
            }
            
            if (!student) {
              const allMembers = await guild.members.fetch({ cache: false }).catch(() => []);
              student = allMembers.find(m => 
                m.nickname === cleanIdentifier || 
                m.user.username === cleanIdentifier ||
                m.displayName === cleanIdentifier
              );
            }
          }
          
          if (!student) {
            return message.reply({
              embeds: [createErrorEmbed('Aluno Não Encontrado', `Usuário "${studentIdentifier}" não encontrado no servidor.`)]
            });
          }

          const actualPoints = scoreType.base_points * scoreType.multiplier;
          const observations = notes.join(' ') || 'Treinamento concluído';

          const session = await addTrainingSession(
            message.author.id,
            student.id,
            resolvedType,
            'Concluído',
            actualPoints,
            observations,
            'complete'
          );

          const instructorMember = await guild.members.fetch(message.author.id).catch(() => null);
          if (instructorMember && hasInstructorRole(instructorMember, '1461134737505652806')) {
            addRoleHolderPoints(message.author.id, actualPoints, resolvedType);
          }

          const channelName = message.channel.name || 'desconhecido';
          const pointsDescription = `${EMOJIS.check} ${scoreType.name} + ${actualPoints}`;
          
          const embed = new EmbedBuilder()
            .setColor(0x57f287)
            .setDescription(`Nesse canal **#${channelName}** foi adicionado as seguintes opções a lista\n\n${pointsDescription}\n\n✨ **Total = ${actualPoints} Pontos**\n\n**Aluno:** ${student.user.tag}${observations && observations !== 'Treinamento concluído' ? `\n**Observação:** ${observations}` : ''}`)
            .setTimestamp();

          await message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Registrar Pontos', err.message)]
          });
        }
      }

      // .claim [aluno]
      if (command === 'claim') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const member = await guild.members.fetch(message.author.id).catch(() => null);
          const instructorRoleId = '1461134737505652806';
          
          if (!hasInstructorRole(member, instructorRoleId)) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Apenas instrutores podem usar este comando.')]
            });
          }

          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.claim <@user|user_id> [instructor2]` - Reivindica um aluno como seu estudante')]
            });
          }

          const studentIdentifier = args[0];
          let student;

          if (studentIdentifier.startsWith('<@') || studentIdentifier.startsWith('<!')) {
            // Handle ping
            const userId = studentIdentifier.replace(/[<@!>]/g, '');
            student = await guild.members.fetch(userId).catch(() => null);
          } else if (/^\d+$/.test(studentIdentifier)) {
            // Handle raw user ID
            student = await guild.members.fetch(studentIdentifier).catch(() => null);
          } else {
            // Handle username/nickname
            const cleanIdentifier = studentIdentifier.replace(/^@/, '');
            const allMembers = await guild.members.fetch({ cache: false }).catch(() => []);
            student = allMembers.find(m => 
              m.nickname === cleanIdentifier || 
              m.user.username === cleanIdentifier ||
              m.displayName === cleanIdentifier
            );
          }

          if (!student) {
            return message.reply({
              embeds: [createErrorEmbed('Aluno Não Encontrado', `Usuário "${studentIdentifier}" não encontrado no servidor.`)]
            });
          }

          const currentInstructorData = await getStudentInstructor(student.id);
          
          // Check if current instructor already claimed this student
          const alreadyClaimed = currentInstructorData.find(instructor => instructor.instructor_id === message.author.id);
          if (alreadyClaimed) {
            return message.reply({
              embeds: [createErrorEmbed('Aluno Já Reivindicado', 'Você já reivindicou este aluno.')]
            });
          }

          // Assign role based on instructor
          const instructorRoles = {
            '327909575799996417': '1480626791273201714', // kingeski
            '216606510829142017': '1480627283738759338', // dekkosun
            '252249131202904074': '1480627188025004083', // topson
            '546492201555722240': '1480627247793573991', // senshi
            '469616482721071134': '1480626743361671351', // crz
            '1357876453680611420': '1480627424973688863', // capiata
            '951624772792496198': '1480627360331202703', // vitor
            '1087012465759485994': '1480627384062578800', // Kay
            '827637149045882901': '1480627336951889941', // Henry
            '466976133980880917': '1480627214289731665', // maid
            '1447168951963353209': '1480538487747903519', // yaya
          };

          const instructorIds = [message.author.id];
          
          // Check for second instructor in args
          if (args.length > 1) {
            const secondId = args[1].replace(/[<@!>]/g, '');
            if (instructorRoles[secondId]) {
              instructorIds.push(secondId);
            }
          }

          // Claim for each instructor
          for (const instId of instructorIds) {
            await claimStudent(instId, student.id);
            
            const roleToAdd = instructorRoles[instId];
            if (roleToAdd) {
              try {
                if (!student.roles.cache.has(roleToAdd)) {
                  await student.roles.add(roleToAdd);
                }
              } catch (err) {
                console.error(`[ERROR] Failed to add role ${roleToAdd} to student:`, err);
              }
            }
          }

          // Get all instructors for this student after claiming
          const allInstructors = await getStudentInstructor(student.id);
          const instructorTags = allInstructors.map(instructor => `<@${instructor.instructor_id}>`).join(', ');

          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Aluno Reivindicado')
            .setDescription(`**${student.user.tag}** foi reivindicado como aluno.`)
            .addFields(
              { name: '👨‍🎓 Aluno', value: `<@${student.id}>`, inline: true },
              { name: '👨‍🏫 Instrutor(es)', value: instructorTags || 'Nenhum', inline: true }
            )
            .setTimestamp();

          return message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Reivindicar', err.message)]
          });
        }
      }

      // .unclaim [aluno]
      if (command === 'unclaim') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.unclaim <@user|user_id>` - Remove sua reivindicação de um aluno')]
            });
          }

          const studentIdentifier = args[0];
          let student;

          if (studentIdentifier.startsWith('<@') || studentIdentifier.startsWith('<!')) {
            // Handle ping
            const userId = studentIdentifier.replace(/[<@!>]/g, '');
            student = await guild.members.fetch(userId).catch(() => null);
          } else if (/^\d+$/.test(studentIdentifier)) {
            // Handle raw user ID
            student = await guild.members.fetch(studentIdentifier).catch(() => null);
          } else {
            // Handle username/nickname
            const cleanIdentifier = studentIdentifier.replace(/^@/, '');
            const allMembers = await guild.members.fetch({ cache: false }).catch(() => []);
            student = allMembers.find(m => 
              m.nickname === cleanIdentifier || 
              m.user.username === cleanIdentifier ||
              m.displayName === cleanIdentifier
            );
          }

          if (!student) {
            return message.reply({
              embeds: [createErrorEmbed('Aluno Não Encontrado', `Usuário "${studentIdentifier}" não encontrado no servidor.`)]
            });
          }

          const currentInstructorData = await getStudentInstructor(student.id);
          
          if (!currentInstructorData || currentInstructorData.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Aluno Não Reivindicado', `Este aluno não foi reivindicado por nenhum instrutor.`)]
            });
          }

          const isAdminUser = await isAdmin(message.author.id);
          const isClaimedInstructor = currentInstructorData.some(instructor => instructor.instructor_id === message.author.id);

          if (!isClaimedInstructor && !isAdminUser) {
            const instructorNames = currentInstructorData.map(instructor => 
              instructor.instructor ? instructor.instructor.username : 'Desconhecido'
            ).join(', ');
            
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', `Este aluno foi reivindicado por **${instructorNames}**. Apenas um dos instrutores que reivindicou ou um administrador pode remover a reivindicação.`)]
            });
          }

          // List of all instructor roles to remove
          const instructorRolesToRemove = [
            '1480626791273201714', // kingeski
            '1480627283738759338', // dekkosun
            '1480627188025004083', // topson
            '1480627247793573991', // senshi
            '1480626743361671351', // crz
            '1480627424973688863', // capiata
            '1480627360331202703', // vitor
            '1480627384062578800', // Kay
            '1480627336951889941', // Henry
            '1480627214289731665', // maid
            '1480538487747903519'  // yaya
          ];

          // Remove only this instructor's association from DB
          await unclaimStudent(message.author.id, student.id);

          // Check if there are still other instructors after removing this one
          const remainingInstructors = await getStudentInstructor(student.id);
          
          // Only remove instructor roles if no other instructors remain
          if (!remainingInstructors || remainingInstructors.length === 0) {
            try {
              const rolesToRemove = student.roles.cache.filter(role => instructorRolesToRemove.includes(role.id));
              if (rolesToRemove.size > 0) {
                await student.roles.remove(rolesToRemove);
                console.log(`[DEBUG] Removed ${rolesToRemove.size} instructor roles from student ${student.id} (no remaining instructors)`);
              }
            } catch (err) {
              console.error('[ERROR] Failed to remove instructor roles:', err);
            }
          } else {
            console.log(`[DEBUG] Kept instructor roles for student ${student.id} (still has ${remainingInstructors.length} instructors)`);
          }

          // Get remaining instructors for the message
          const remainingInstructorTags = remainingInstructors && remainingInstructors.length > 0 
            ? remainingInstructors.map(instructor => `<@${instructor.instructor_id}>`).join(', ')
            : 'Nenhum';

          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Reivindicação Removida')
            .setDescription(`**${message.author.tag}** removeu sua reivindicação de **${student.user.tag}**.`)
            .addFields(
              { name: '👨‍🎓 Aluno', value: `<@${student.id}>`, inline: true },
              { name: '👨‍🏫 Instrutores restantes', value: remainingInstructorTags, inline: true }
            )
            .setTimestamp();

          return message.reply({ embeds: [embed] });
        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro ao Remover Reivindicação', err.message)]
          });
        }
      }

      // ---- .instrutor ----
      if (command === 'instrutor' || command === 'instrutorl') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const member = await guild.members.fetch(message.author.id).catch(() => null);
          const instructorRoleId = '1461134737505652806';
          
          if (!hasInstructorRole(member, instructorRoleId)) {
            return message.reply({
              embeds: [createErrorEmbed('Acesso Negado', 'Apenas usuários com cargo de instrutor podem usar este comando.')]
            });
          }

          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 
                `Uso: \`.instrutor <comando>\`\n\nComandos disponíveis:\n• \`pontos [tipo] [pontos] [aluno] [observações]\` - Registrar pontos\n• \`sessao [tipo] [pontos] [aluno] [duração] [observações]\` - Iniciar sessão\n• \`concluir [ID] [observações]\` - Concluir sessão\n• \`parcial [ID] [pontos] [observações]\` - Registrar progresso parcial\n• \`historico [aluno|ID]\` - Ver histórico\n• \`ranking\` - Ver ranking\n• \`tipos\` - Ver tipos de pontuação\n• \`alunos\` - Ver seus alunos reivindicados`)]
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
              const cmdScoreTypes = await getScoreTypes();
              const cmdResolvedType = TRAINING_TYPE_ALIASES[cmdType] || cmdType;
              const cmdScoreType = cmdScoreTypes[cmdResolvedType];
              
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

              const cmdStudent = await guild.members.fetch(cmdStudentId.replace(/[<@!>]/g, '')).catch(() => null);
              if (!cmdStudent) {
                return message.reply({
                  embeds: [createErrorEmbed('Aluno Não Encontrado', 'Não foi possível encontrar o aluno na guild.')]
                });
              }

              const cmdActualPoints = cmdParsedPoints * cmdScoreType.base_points;
              const cmdObservations = cmdNotes.join(' ') || 'Treinamento concluído';

              await addTrainingSession(
                instructorId,
                cmdStudent.id,
                cmdResolvedType,
                'Concluído',
                cmdActualPoints,
                cmdObservations,
                'complete'
              );

              const cmdEmbed = createSuccessEmbed(
                'Pontos adicionados com sucesso',
                `**Aluno:** ${cmdStudent.user.tag}\n**Tipo:** ${cmdScoreType.name}\n**Pontos:** ${cmdActualPoints}${cmdObservations ? `\n**Observações:** ${cmdObservations}` : ''}`
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
              const sessScoreTypes = await getScoreTypes();
              const sessResolvedType = TRAINING_TYPE_ALIASES[sessType] || sessType;
              const sessScoreType = sessScoreTypes[sessResolvedType];
              
              if (!sessScoreType) {
                return message.reply({
                  embeds: [createErrorEmbed('Tipo Inválido', 'Tipo não encontrado. Use `.instrutor tipos` para ver os disponíveis.')]
                });
              }

              const sessStudent = await guild.members.fetch(sessStudentId.replace(/[<@!>]/g, '')).catch(() => null);
              if (!sessStudent) {
                return message.reply({
                  embeds: [createErrorEmbed('Aluno Não Encontrado', 'Não foi possível encontrar o aluno na guild.')]
                });
              }

              const sessSession = await addTrainingSession(
                instructorId,
                sessStudent.id,
                sessResolvedType,
                sessDuration,
                0,
                sessNotes.join(' ') || 'Sessão iniciada',
                'active'
              );

              const sessEmbed = createSuccessEmbed(
                'Sessão iniciada',
                `**Aluno:** ${sessStudent.user.tag}\n**Tipo:** ${sessScoreType.name}\n**Duração:** ${sessDuration}\n**ID:** ${sessSession.id}`
              );

              await message.reply({ embeds: [sessEmbed] });
              break;

            case 'ranking':
            case 'leaderboard':
            case 'top':
              const leaderboard = await getInstructorLeaderboard(10);
              
              if (leaderboard.length === 0) {
                return message.reply({
                  embeds: [createErrorEmbed('Ranking Vazio', 'Ainda não há dados de instrutores no sistema.')]
                });
              }

              const rankEmbed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`${EMOJIS.graduation} Ranking de Instrutores`)
                .setDescription('Os instrutores mais ativos da guilda baseados em pontos de treinamento.')
                .setTimestamp();

              leaderboard.forEach((stat, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                rankEmbed.addFields({
                  name: `${medal} ${stat.username}`,
                  value: `**Pontos:** ${stat.total_points} | **Sessões:** ${stat.total_sessions} | **Alunos:** ${stat.students_count}`,
                  inline: false
                });
              });

              await message.reply({ embeds: [rankEmbed] });
              break;

            case 'tipos':
              const typesScoreTypes = await getScoreTypes();
              const typeDescriptions = Object.entries(typesScoreTypes).map(([key, type]) => 
                `**${type.name}** (${type.base_points} pts)\n   Atalhos: ${Object.entries(TRAINING_TYPE_ALIASES).filter(([alias, real]) => real === key).map(([alias]) => alias).join(', ')}`
              ).join('\n\n');
              
              const typesEmbed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🎓 Tipos de Treinamento')
                .setDescription(typeDescriptions || 'Nenhum tipo de treinamento configurado.')
                .setFooter({ text: 'Use os atalhos para agilizar!' })
                .setTimestamp();
              await message.reply({ embeds: [typesEmbed] });
              break;

            case 'alunos':
              const instructorStudents = await getInstructorStudents(message.author.id);

              if (instructorStudents.length === 0) {
                return message.reply({
                  embeds: [createErrorEmbed('Nenhum Aluno', 'Você não reivindicou nenhum aluno ainda. Use `.claim [aluno]` para reivindicar um aluno.')]
                });
              }

              const studentDetails = [];
              for (const studentData of instructorStudents) {
                const student = await guild.members.fetch(studentData.student_id).catch(() => null);
                if (student) {
                  studentDetails.push({
                    nickname: student.nickname || student.user.username,
                    tag: student.user.tag,
                    id: student.id
                  });
                }
              }

              const studentsList = studentDetails.map((student, index) => 
                `**${index + 1}.** ${student.nickname} (${student.tag}) - <@${student.id}>`
              ).join('\n');

              const alunosEmbed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`👨‍🎓 Alunos de ${message.author.tag}`)
                .setDescription(`Você tem **${studentDetails.length}** aluno(s) reivindicado(s):\n\n${studentsList}`)
                .setTimestamp();

              await message.reply({ embeds: [alunosEmbed] });
              break;

            case 'stats':
              const roleStats = getRoleHolderStats(message.author.id);
              const statsOutput = createSuccessEmbed(
                '📊 Minhas Estatísticas',
                `**Pontos totais:** ${roleStats.total_points}\n**Sessões completadas:** ${roleStats.sessions_completed}\n**Última atividade:** ${roleStats.last_activity ? new Date(roleStats.last_activity).toLocaleDateString('pt-BR') : 'Nunca'}\n\n**Tipos de treinamento:**\n${Object.entries(roleStats.types_completed || {}).map(([type, count]) => `• ${type}: ${count} sessões`).join('\n')}`
              );
              await message.reply({ embeds: [statsOutput] });
              break;

            default:
              return message.reply({
                embeds: [createErrorEmbed('Subcomando Inválido', 'Subcomando não reconhecido. Use `.instrutor` para ver os comandos disponíveis.')]
              });
          }
        } catch (err) {
          console.error('[Instructor Command Error]', err);
          await message.reply({
            embeds: [createErrorEmbed('Erro no Comando', err.message)]
          });
        }
      }

      // ---- .shop ----
      if (command === 'shop') {
        try {
          const guild = client.guilds.cache.get(discordConfig.guildId);
          if (!guild) throw new Error('Guild não encontrada');

          const categoryMap = {
            'cos': 'Cosmética',
            'cosmetica': 'Cosmética',
            'func': 'Funcional',
            'funcional': 'Funcional',
            'status': 'Status',
            'stat': 'Status',
            'rank': 'Status',
            'vip': 'Status'
          };

          let category = args[0]?.toLowerCase();
          
          if (!category) {
            const allItems = await getShopItems();
            const userPoints = await calculateTotalScore(message.author.id, false);
            
            const categorySelect = new StringSelectMenuBuilder()
              .setCustomId('shop_category_select')
              .setPlaceholder('🛍 Escolha uma categoria...')
              .addOptions(
                { label: '✨ Cosmética', value: 'Cosmética', description: 'Cargos, cores e visuais', emoji: '✨' },
                { label: '⚙️ Funcional', value: 'Funcional', description: 'Ferramentas e utilidades', emoji: '⚙️' },
                { label: '👑 Status', value: 'Status', description: 'Privilégios e vantagens', emoji: '👑' },
                { label: '📦 Ver Todos', value: 'Todos', description: 'Mostrar todos os itens', emoji: '📦' }
              );

            const row = new ActionRowBuilder().addComponents(categorySelect);
            
            const mainEmbed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('Loja de Recompensas')
              .setDescription('**Seus Pontos:** 💰 ' + userPoints + ' pts\n\n**Como usar:**\n• Escolha uma categoria no menu abaixo\n• Ou use abreviações: `.shop cos`, `.shop func`, `.shop stat`\n• Para comprar: `.buy [ID]`')
              .setFooter({ text: 'Escolha uma categoria para ver os itens' })
              .setTimestamp();

            const shopMessage = await message.reply({ 
              embeds: [mainEmbed], 
              components: [row] 
            });

            const collector = shopMessage.createMessageComponentCollector({ 
              time: 60000
            });

            collector.on('collect', async (interaction) => {
              if (interaction.user.id !== message.author.id) {
                return interaction.reply({ 
                  content: 'Você não pode usar este menu!', 
                  ephemeral: true 
                });
              }

              const selectedCategory = interaction.values[0];
              await interaction.update({ components: [] });

              let itemsToShow = selectedCategory === 'Todos' 
                ? allItems 
                : await getShopItemsByCategory(selectedCategory);

              const itemsPerPage = 3;
              const totalPages = Math.ceil(itemsToShow.length / itemsPerPage);
              let currentPage = 0;

              const createPageEmbed = (page) => {
                const startIndex = page * itemsPerPage;
                const endIndex = Math.min(startIndex + itemsPerPage, itemsToShow.length);
                const pageItems = itemsToShow.slice(startIndex, endIndex);

                const pageEmbed = new EmbedBuilder()
                  .setColor(0x57f287)
                  .setTitle(`Loja - ${selectedCategory}`)
                  .setDescription(`**Seus Pontos:** 💰 ${userPoints} pts\n\n**Página ${page + 1}/${totalPages}**`)
                  .setTimestamp();

                if (pageItems.length === 0) {
                  pageEmbed.addFields({
                    name: 'Nenhum item encontrado',
                    value: 'Esta categoria não possui itens no momento.',
                    inline: false
                  });
                } else {
                  pageItems.forEach(item => {
                    const canAfford = userPoints >= item.cost;
                    const status = canAfford ? '✅' : '❌';
                    
                    pageEmbed.addFields({
                      name: `${status} ${item.name} (${item.cost} pts)`,
                      value: `**ID:** ${item.id}\n${item.description}`,
                      inline: false
                    });
                  });
                }

                return pageEmbed;
              };              const createNavigationRows = (page) => {
                const rows = [];
                
                if (totalPages > 1) {
                  const navRow = new ActionRowBuilder();
                  
                  const prevButton = new ButtonBuilder()
                    .setCustomId('prev_page')
                    .setLabel('⬅️ Anterior')
                    .setStyle('Secondary')
                    .setDisabled(page === 0);

                  const nextButton = new ButtonBuilder()
                    .setCustomId('next_page')
                    .setLabel('Próxima ➡️')
                    .setStyle('Secondary')
                    .setDisabled(page === totalPages - 1);

                  navRow.addComponents(prevButton, nextButton);
                  rows.push(navRow);
                }

                return rows;
              };

              await interaction.followUp({ 
                embeds: [createPageEmbed(0)], 
                components: createNavigationRows(0) 
              });

              const pageCollector = interaction.channel.createMessageComponentCollector({ 
                time: 300000
              });

              pageCollector.on('collect', async (pageInteraction) => {
                if (pageInteraction.user.id !== message.author.id) return;

                if (pageInteraction.customId === 'prev_page' && currentPage > 0) {
                  currentPage--;
                } else if (pageInteraction.customId === 'next_page' && currentPage < totalPages - 1) {
                  currentPage++;
                }

                await pageInteraction.update({ 
                  embeds: [createPageEmbed(currentPage)], 
                  components: createNavigationRows(currentPage) 
                });
              });

              pageCollector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => {});
              });
            });

            collector.on('end', () => {
              shopMessage.edit({ components: [] }).catch(() => {});
            });

            return;
          }

          const mappedCategory = categoryMap[category] || category;
          const shopItems = await getShopItemsByCategory(mappedCategory);
          
          if (shopItems.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Categoria Inválida', `Categoria "${category}" não encontrada.\n\n**Disponíveis:** cos (Cosmética), func (Funcional), stat (Status)\nUse \`.shop\` para ver menu.`)]
            });
          }

          const userPoints = await calculateTotalScore(message.author.id, false);
          const shopEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(`Loja - ${mappedCategory}`)
            .setDescription('**Seus Pontos:** 💰 ' + userPoints + ' pts\n\nUse `.buy [ID]` para comprar um item')
            .setTimestamp();

          const categoryEmoji = {
            'Cosmética': '✨',
            'Funcional': '⚙️',
            'Status': '👑'
          }[mappedCategory] || '📦';

          shopItems.forEach(item => {
            const canAfford = userPoints >= item.cost;
            const status = canAfford ? '✅' : '❌';
            
            shopEmbed.addFields({
              name: `${status} ${item.name} (${item.cost} pts)`,
              value: `**ID:** ${item.id}\n${item.description}`,
              inline: false
            });
          });

          await message.reply({ embeds: [shopEmbed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro na Loja', err.message)]
          });
        }
      }

      // ---- .buy ----
      if (command === 'buy') {
        try {
          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.buy [ID]` ou `.comprar [ID]`')]
            });
          }

          const itemId = args[0];
          const userPoints = await calculateTotalScore(message.author.id, false);

          try {
            const result = await purchaseItem(message.author.id, itemId);
            
            const embed = createSuccessEmbed(
              'Compra Realizada',
              `**Item:** ${result.item.name}\n**Custo:** ${result.item.cost} pontos\n**Pontos restantes:** ${result.remaining_points}\n\n${result.item.description}`
            );

            await message.reply({ embeds: [embed] });

            await applyRewardEffect(message.author.id, result.item);

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

      // ---- .instrutorl ----
      if (command === 'instrutorl') {
        try {
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
              const startScoreTypes = await getScoreTypes();
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

              const startSession = addTrainingSession(
                instructorId,
                startStudentId,
                startType,
                startDuration,
                0,
                `Sessão iniciada via instrutorl`,
                'active'
              );

              const startEmbed = createSuccessEmbed(
                'Treinamento iniciado',
                `**Aluno:** ${startStudent.user.tag}\n**Tipo:** ${startScoreType.name}\n**Duração:** ${startDuration}\n**ID:** ${startSession.id}\n\nUse \`.instrutorl finalizar ${startSession.id} [pontos]\` para concluir.`
              );

              await message.reply({ embeds: [startEmbed] });
              break;

            case 'finalizar':
              const statsSessions = await getInstructorSessions(instructorId, 5);
              const scoreTypes = await getScoreTypes();

              const statsEmbed = createSuccessEmbed(
                '📊 Minhas Estatísticas',
                `**Pontos como Instrutor:** ${statsInstructorPoints}\n**Pontos como Aluno:** ${statsStudentPoints}\n**Total de Sessões:** ${statsSessions.length}\n\n**Últimas sessões:**\n` +
                (statsSessions.length > 0 
                  ? statsSessions.slice(0, 3).map((s, i) => 
                      `${i + 1}. ${s.status === 'complete' ? '✅' : '🔄'} <@${s.student_id}> - ${scoreTypes[s.type]?.name || s.type}`
                    ).join('\n')
                  : 'Nenhuma sessão ainda'
                )
              );

              await message.reply({ embeds: [statsEmbed] });
              break;

            case 'top':
            case 'ranking':
              const topInstructors = await getInstructorLeaderboard();
              
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
              const shopItems = await getShopItems();
              const userPoints = await calculateTotalScore(message.author.id, false);
              
              const shopEmbed = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('🛍 Loja de Recompensas')
                .setDescription(`Você tem **${userPoints} pontos** disponíveis.\n\nUse \`.buy [ID]\` para comprar itens ou \`.shop\` para ver o menu completo.`)
                .setTimestamp();

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

      // ---- .finduser ----
      if (command === 'finduser') {
        try {
          if (args.length === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Formato Inválido', 'Uso: `.finduser [nome, ID, ou parte do nome]`')]
            });
          }

          const searchTerm = args.join(' ').toLowerCase();
          const guild = client.guilds.cache.get(discordConfig.guildId);
          
          if (!guild) {
            return message.reply({
              embeds: [createErrorEmbed('Erro', 'Guild não encontrada')]
            });
          }

          const allMembers = await guild.members.fetch({ cache: false });
          const matches = allMembers.filter(m => 
            m.user.username.toLowerCase().includes(searchTerm) ||
            m.nickname?.toLowerCase().includes(searchTerm) ||
            m.displayName.toLowerCase().includes(searchTerm) ||
            m.user.id === searchTerm
          );

          if (matches.size === 0) {
            return message.reply({
              embeds: [createErrorEmbed('Nenhum Usuário Encontrado', `Nenhum usuário encontrado para: "${searchTerm}"`)]
            });
          }

          const results = matches.first(10).map((member, index) => {
            return `**${index + 1}.** ${member.user.tag} (${member.user.id})\n   • Nickname: ${member.nickname || 'Nenhum'}\n   • Display: ${member.displayName}`;
          }).join('\n\n');

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`🔍 Resultados da Busca (${matches.size} encontrados)`)
            .setDescription(results)
            .setFooter({ text: `Buscando por: "${searchTerm}"` });

          return message.reply({ embeds: [embed] });

        } catch (err) {
          await message.reply({
            embeds: [createErrorEmbed('Erro na Busca', err.message)]
          });
        }
      }
    } catch (err) {
      console.error('[Command Error]', err);
      await message.reply({ embeds: [createErrorEmbed('Erro Interno', `Um erro inesperado ocorreu: ${err.message}`)] }).catch(() => {});
    }
  });

  // Periodic inactive player reminder scheduled during startup
  const ENABLE_INACTIVE_REMINDER = false; // Set to true to enable, false to disable
  
  async function sendInactivePlayersReminder() {
    if (!ENABLE_INACTIVE_REMINDER) {
      console.log('[Inactive Reminder] Disabled by configuration');
      return;
    }
    
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
        content: mentions,
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

  if (inactivePlayersConfig.channelId && ENABLE_INACTIVE_REMINDER) {
    const interval = parseInt(inactivePlayersConfig.messageInterval) || 10800000;
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
