/**
 * TGG Bot: Discord bot with prefix commands (.) for role sync and guild management.
 * Admin-only commands (users in ALLOWED_USER_IDS can run these).
 * Commands: .sync-guild-roles, .sync-elo-roles, .guild-activity, .movimentacao, .help
 */

import 'dotenv/config';
import { EmbedBuilder } from 'discord.js';
import { getUsers, getUsersWithElo } from './src/db.js';
import { createClient, runSync, runEloSync } from './src/discord.js';
import { runAndPostGuildActivity } from './src/guildActivity.js';
import { fetchMovimentacao, buildMovimentacaoEmbeds, getDefaultDateRange, isValidDate } from './src/movimentacao.js';
import { syncNicknames, updateMemberNicknameDiscordPortion, parseNickname, buildNickname, fetchBrawlhallaClanData, loadClanCache } from './src/nicknameSync.js';
import { loadCustomNicknames } from './src/customNicknames.js';
import { discord as discordConfig, ALLOWED_USER_IDS } from './config/index.js';
import { getUserByDiscordId } from './src/db.js';

async function main() {
  if (!discordConfig.token || !discordConfig.guildId) {
    console.error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env');
    process.exit(1);
  }

  const client = createClient();
  const PREFIX = '.';

  client.once('clientReady', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
  });

  /**
   * Check if user is admin
   */
  function isAdmin(userId) {
    return ALLOWED_USER_IDS.includes(userId);
  }

  /**
   * Create error embed
   */
  function createErrorEmbed(title, message) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`<:icon_x:872277999687442472> ${title}`)
      .setDescription(message)
      .setTimestamp();
  }

  /**
   * Create success embed with footer
   */
  function createSuccessEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`<:icon_v:825250296987910144> ${title}`)
      .setDescription(description)
      .setTimestamp();
  }

  // Message handler for prefix commands
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    if (!command) return;

    // .nickname command - DISABLED FOR NOW
    if (command === 'nickname') {
      return message.reply({
        embeds: [
          createErrorEmbed(
            'Comando Desativado',
            'O comando `.nickname` está desativado no momento.'
          ),
        ],
      });
    }

    // Admin check for all other commands
    if (!isAdmin(message.author.id)) {
      const embed = createErrorEmbed(
        'Acesso Negado',
        'Apenas administradores podem usar estes comandos.'
      );
      return message.reply({ embeds: [embed] });
    }

    try {
      // .help command
      if (command === 'help') {
        const helpEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('<:g_ponto_white_RR:1305837905624698880> Comandos Disponíveis')
          .addFields(
            {
              name: '<a:seta:851206127471034378> .sync-guild-roles',
              value: 'Sincronizar ranks da guild (recruit/member/officer)',
              inline: false,
            },
            {
              name: '<a:seta:851206127471034378> .sync-elo-roles',
              value: 'Sincronizar roles de ELO dos jogadores',
              inline: false,
            },
            {
              name: '<a:seta:851206127471034378> .sync-nicknames',
              value: 'Sincronizar apelidos com clan Brawlhalla (formato: brawlhallaName/discordName)\nUsa cache quando disponível, chama API apenas se necessário',
              inline: false,
            },
            {
              name: '<a:seta:851206127471034378> .refresh-clan-cache',
              value: 'Atualiza o cache do clan direto da Brawlhalla API',
              inline: false,
            },
            {
              name: '<a:seta:851206127471034378> .nickname <newName>',
              value: '**[PARA TODOS]** Mudar apenas a parte Discord do apelido (mantém o nome Brawlhalla da API)\nExemplo: `.nickname disneyritozx`\nAntes: `yaya_s2/oldname` → Depois: `yaya_s2/disneyritozx`',
              inline: false,
            },
            {
              name: '<a:seta:851206127471034378> .guild-activity',
              value: 'Sincronizar e postar atividade da guild',
              inline: false,
            },
            {
              name: '<:time2:1406766019589967924> .movimentacao [start_date] [end_date]',
              value: 'Buscar movimentação da guild\nFormato: YYYY-MM-DD (ex: .movimentacao 2025-02-01 2025-02-22)',
              inline: false,
            },
            {
              name: '<a:seta:851206127471034378> .help',
              value: 'Mostrar esta mensagem',
              inline: false,
            }
          )
          .setFooter({ text: 'em minha defesa a ia fez o embed' })
          .setTimestamp();
        return message.reply({ embeds: [helpEmbed] });
      }

      // .sync-guild-roles command
      if (command === 'sync-guild-roles') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle('⏳ Sincronizando...')
              .setDescription('Sincronizando ranks da guild...'),
          ],
        });

        try {
          const users = await getUsers();
          const result = await runSync(client, users);
          const resultEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Sincronização de Ranks Concluída')
            .addFields(
              { name: 'Sincronizados', value: `${result.synced}`, inline: true },
              { name: 'Ignorados', value: `${result.skipped}`, inline: true },
              { name: 'Erros', value: `${result.errors}`, inline: true }
            )
            .setTimestamp();
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await loading.edit({
            embeds: [createErrorEmbed('Erro de Sincronização', err.message)],
          });
        }
      }

      // .sync-elo-roles command
      if (command === 'sync-elo-roles') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle('⏳ Sincronizando...')
              .setDescription('Sincronizando roles de ELO...'),
          ],
        });

        try {
          const usersWithElo = await getUsersWithElo();
          const result = await runEloSync(client, usersWithElo);
          const resultEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Sincronização de ELO Concluída')
            .addFields(
              { name: 'Sincronizados', value: `${result.synced}`, inline: true },
              { name: 'Ignorados', value: `${result.skipped}`, inline: true },
              { name: 'Erros', value: `${result.errors}`, inline: true }
            )
            .setTimestamp();
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await loading.edit({
            embeds: [createErrorEmbed('Erro de Sincronização', err.message)],
          });
        }
      }

      // .guild-activity command
      if (command === 'guild-activity') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle('⏳ Sincronizando...')
              .setDescription('Buscando atividade da guild...'),
          ],
        });

        try {
          const result = await runAndPostGuildActivity(client);
          if (result.ok) {
            const summary = result.summary || {};
            const resultEmbed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('✅ Sincronização de Atividade Concluída')
              .addFields(
                { name: 'Entradas', value: `${summary.entrou ?? 0}`, inline: true },
                { name: 'Saídas', value: `${summary.saiu ?? 0}`, inline: true },
                { name: 'Promoções', value: `${summary.promovido ?? 0}`, inline: true },
                { name: 'Rebaixamentos', value: `${summary.rebaixado ?? 0}`, inline: true },
                { name: 'Saldo Líquido', value: `${summary.saldo_liquido ?? 0}`, inline: true },
                { name: 'Postado', value: result.posted ? 'Sim' : 'Não configurado', inline: true }
              )
              .setTimestamp();
            await loading.edit({ embeds: [resultEmbed] });
          } else {
            await loading.edit({
              embeds: [createErrorEmbed('Erro na Sincronização', result.error)],
            });
          }
        } catch (err) {
          await loading.edit({
            embeds: [createErrorEmbed('Erro na Sincronização', err.message)],
          });
        }
      }

      // .movimentacao command
      if (command === 'movimentacao') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle('⏳ Buscando...')
              .setDescription('Carregando dados de movimentação...'),
          ],
        });

        try {
          let startDate, endDate;

          // Parse date arguments
          if (args.length >= 3) {
            startDate = args[1];
            endDate = args[2];

            if (!isValidDate(startDate) || !isValidDate(endDate)) {
              return loading.edit({
                embeds: [
                  createErrorEmbed(
                    'Formato de Data Inválido',
                    'Use formato YYYY-MM-DD\nExemplo: `.movimentacao 2025-02-01 2025-02-22`'
                  ),
                ],
              });
            }
          } else {
            // Default to last 7 days
            const range = getDefaultDateRange();
            startDate = range.startDate;
            endDate = range.endDate;
          }

          console.log(`[Command] .movimentacao called with dates: ${startDate} to ${endDate}`);
          const data = await fetchMovimentacao(startDate, endDate, 5000);
          console.log(`[Command] API returned successfully, building embeds...`);
          const embeds = buildMovimentacaoEmbeds(data.data || [], startDate, endDate);

          // Send in chunks of 10 embeds per message
          const EMBEDS_PER_MESSAGE = 10;
          for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
            const chunk = embeds.slice(i, i + EMBEDS_PER_MESSAGE);
            if (i === 0) {
              await loading.edit({ embeds: chunk });
            } else {
              await message.reply({ embeds: chunk });
            }
          }
        } catch (err) {
          console.error('[Command] Error:', err.message);
          await loading.edit({
            embeds: [createErrorEmbed('Erro na API', err.message)],
          });
        }
      }

      // .sync command (runs both guild and ELO sync)
      if (command === 'sync') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle('⏳ Sincronizando...')
              .setDescription('Executando sincronização completa...'),
          ],
        });

        try {
          const users = await getUsers();
          const guildResult = await runSync(client, users);
          const usersWithElo = await getUsersWithElo();
          const eloResult = await runEloSync(client, usersWithElo);

          const resultEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Sincronização Completa Concluída')
            .addFields(
              {
                name: 'Ranks da Guild',
                value: `Sincronizados: ${guildResult.synced} | Ignorados: ${guildResult.skipped} | Erros: ${guildResult.errors}`,
                inline: false,
              },
              {
                name: 'Roles de ELO',
                value: `Sincronizados: ${eloResult.synced} | Ignorados: ${eloResult.skipped} | Erros: ${eloResult.errors}`,
                inline: false,
              }
            )
            .setTimestamp();
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await loading.edit({
            embeds: [createErrorEmbed('Erro de Sincronização', err.message)],
          });
        }
      }

      // .sync-nicknames command
      if (command === 'sync-nicknames') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle('⏳ Sincronizando...')
              .setDescription('Sincronizando apelidos com clan Brawlhalla...'),
          ],
        });

        try {
          await loadCustomNicknames();
          const result = await syncNicknames(client, discordConfig.guildId);
          
          const resultEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Sincronização de Apelidos Concluída')
            .addFields(
              { name: 'Sincronizados', value: `${result.synced}`, inline: true },
              { name: 'Atualizados', value: `${result.updated}`, inline: true },
              { name: 'Sem Alteração', value: `${result.unchanged}`, inline: true },
              { name: 'Erros', value: `${result.failed}`, inline: true }
            )
            .setTimestamp();
          
          if (result.errors.length > 0 && result.errors.length <= 5) {
            const errorList = result.errors.map((e) => `• ${e.error}`).join('\n');
            resultEmbed.addFields({ name: 'Próximos erros', value: errorList, inline: false });
          }
          
          await loading.edit({ embeds: [resultEmbed] });
        } catch (err) {
          await loading.edit({
            embeds: [createErrorEmbed('Erro de Sincronização', err.message)],
          });
        }
      }

      // .refresh-clan-cache command (refresh clan data from API)
      if (command === 'refresh-clan-cache') {
        const loading = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle('⏳ Atualizando...')
              .setDescription('Atualizando cache do clan Brawlhalla...'),
          ],
        });

        try {
          const clanData = await fetchBrawlhallaClanData();
          
          message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('✅ Cache Atualizado')
                .setDescription(`Cache do clan atualizado com ${clanData.clan?.length || 0} membros`)
                .addFields(
                  { name: 'Clan ID', value: `${clanData.clan_id}`, inline: true },
                  { name: 'Clan Name', value: `${clanData.clan_name}`, inline: true },
                  { name: 'Membros', value: `${clanData.clan?.length || 0}`, inline: true }
                )
                .setTimestamp(),
            ],
          });
          
          await loading.delete();
        } catch (err) {
          await loading.edit({
            embeds: [createErrorEmbed('Erro ao Atualizar Cache', err.message)],
          });
        }
      }

      } catch (err) {
        console.error('[Command Error]', err);
      const embed = createErrorEmbed(
        'Erro Interno',
        `Um erro inesperado ocorreu: ${err.message}`
      );
      await message.reply({ embeds: [embed] }).catch(() => {});
    }
  });

  await client.login(discordConfig.token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
