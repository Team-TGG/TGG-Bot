// Comandos públicos
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle, ChannelType, PermissionsBitField } from 'discord.js';
import * as publicHandlers from '../public.js';
import { createErrorEmbed, createSuccessEmbed, createLoadingEmbed, sendCleanMessage, createPagination, awaitConfirmation } from '../../utils/discordUtils.js';
import { adminOnly, leaderOnly, ROLE_HIERARCHY } from '../../utils/permissions.js';
import { STAFF_ROLE_IDS } from '../../config/index.js';
import { EMOJIS } from '../../config/emojis.js';

/**
 * Jogos da semana a partir dos dados atuais e da base gravada no início dela.
 *
 * **`stats.games` já inclui as partidas ranked** — medido em 2.198 semanas fechadas com dados
 * limpos: em 99% delas o ganho de `games` é maior ou igual à soma dos ranked, 237 semanas fecham
 * com a diferença em exatamente 0 (semana só de ranked) e **nenhuma** teve ganho de `games` zerado
 * tendo jogado ranked. Se `games` excluísse ranked, quem só joga ranked apareceria com 0 o tempo
 * todo, o que não acontece.
 *
 * Por isso o total é a diferença crua de `games`, e o casual é o que sobra depois de tirar os
 * modos ranked. A versão anterior somava ranked por fora, o que inflava o total e fazia o campo
 * "casuais" mostrar, na verdade, o total.
 */
export function calculateGames(stats, ranked, initial) {
  const currentGames = stats.games ?? 0;
  const current1v1 = ranked.games ?? 0;

  let current2v2 = 0;

  if (ranked['2v2']) {
    ranked['2v2'].forEach(team => {
      current2v2 += team.games ?? 0;
    });
  }

  const current3v3 = ranked.rotating_ranked?.games ?? 0;

  const games1v1 = current1v1 - (initial.initial_games_1v1 ?? 0);
  const games2v2 = current2v2 - (initial.initial_games_2v2 ?? 0);
  const games3v3 = current3v3 - (initial.initial_games_3v3 ?? 0);

  const totalGames = currentGames - (initial.games ?? 0);

  // Piso em 0: o 2v2 da API só passa a listar um time depois de 10 partidas, então a semana em
  // que um time cruza esse limiar recebe o histórico dele de uma vez e o ranked pode passar o
  // total. Ocorre em ~1% das semanas; casual negativo seria lido como bug.
  const casualGames = Math.max(0, totalGames - games1v1 - games2v2 - games3v3);

  return {totalGames, casualGames, games1v1, games2v2, games3v3};
}

/**
 * Mesma conta do `calculateGames`, mas para uma semana já fechada: em vez dos dados
 * atuais da API usa os campos `final_*` que o cron do site grava no fechamento.
 *
 * `games`/`final_games` são cópias de `stats.games`, que já inclui ranked — ver a nota em
 * `calculateGames`.
 */
export function calculateGamesFromClosedWeek(week) {
  const games1v1 = (week.final_games_1v1 ?? 0) - (week.initial_games_1v1 ?? 0);
  const games2v2 = (week.final_games_2v2 ?? 0) - (week.initial_games_2v2 ?? 0);
  const games3v3 = (week.final_games_3v3 ?? 0) - (week.initial_games_3v3 ?? 0);

  const totalGames = (week.final_games ?? 0) - (week.games ?? 0);
  const casualGames = Math.max(0, totalGames - games1v1 - games2v2 - games3v3);

  return {totalGames, casualGames, games1v1, games2v2, games3v3};
}