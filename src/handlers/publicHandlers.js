// Comandos públicos
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle, ChannelType, PermissionsBitField } from 'discord.js';
import * as publicHandlers from '../public.js';
import { createErrorEmbed, createSuccessEmbed, createLoadingEmbed, sendCleanMessage, createPagination, awaitConfirmation } from '../../utils/discordUtils.js';
import { adminOnly, leaderOnly, ROLE_HIERARCHY } from '../../utils/permissions.js';
import { STAFF_ROLE_IDS } from '../../config/index.js';
import { EMOJIS } from '../../config/emojis.js';

// Função para calcular os jogos a partir dos dados atuais e iniciais
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

  const totalGames = currentGames - (initial.games ?? 0) + games1v1 + games2v2 + games3v3;
  const casualGames = totalGames - games1v1 - games2v2 - games3v3;

  return {totalGames, casualGames, games1v1, games2v2, games3v3};
}