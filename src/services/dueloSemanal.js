import { fetchGuildStatsNewAPI } from '../brawlhalla.js';
import { getGuildWeeklyGuildPoints, getDuelGuildWeeklyGuildPoints } from '../guild.js';
import { guildDuel as config } from '../../config/index.js';

/**
 * Placar do duelo da semana: quanto cada guilda ganhou desde a virada de quinta.
 *
 * O que vale é a **diferença**, não o acumulado — guild points nunca zeram, então comparar os
 * totais diria só qual guilda é mais velha. A linha de base de cada lado vem do banco
 * (`guild_weekly_guild_points` para nós, `guild_duels` para o oponente, ambos gravados pelo cron
 * de quarta 07:00) e o valor atual sai da API.
 *
 * Extraído de `handleDuel` quando o `.ia` passou a responder sobre o duelo: são duas rotinas lendo
 * o mesmo placar, e a staff perguntando "quem tá ganhando?" tem que ouvir o mesmo que o `.duel`
 * mostra. O embed continua sendo de quem chama — aqui só sai número.
 */

/** Sem oponente cadastrado não há duelo para medir; quem chama decide o que dizer. */
export const SEM_DUELO = {
  SEM_OPONENTE: 'SEM_OPONENTE',
  OPONENTE_SEM_ID: 'OPONENTE_SEM_ID',
};

export async function calcularDueloDaSemana() {
  const [nossaApi, nossaBase, duelo] = await Promise.all([
    fetchGuildStatsNewAPI(config.ourGuildId),
    getGuildWeeklyGuildPoints(),
    getDuelGuildWeeklyGuildPoints(),
  ]);

  if (!duelo) return { motivo: SEM_DUELO.SEM_OPONENTE };
  if (!duelo.guild_id) return { motivo: SEM_DUELO.OPONENTE_SEM_ID };

  const oponenteApi = await fetchGuildStatsNewAPI(duelo.guild_id);

  const lado = (api, base) => ({
    nome: api?.name ?? 'Desconhecida',
    membros: api?.member_count ?? null,
    convite: api?.discord_invite_code ?? null,
    pontosAtuais: Number(api?.guild_points || 0),
    pontosNaVirada: Number(base || 0),
    ganhoNaSemana: Number(api?.guild_points || 0) - Number(base || 0),
  });

  const nos = lado(nossaApi, nossaBase?.total_guild_points);
  const eles = lado(oponenteApi, duelo.guild_points);

  return {
    motivo: null,
    nos,
    eles,
    oponenteGuildId: String(duelo.guild_id),
    diferenca: Math.abs(nos.ganhoNaSemana - eles.ganhoNaSemana),
    // null = empate. Quem chama traduz para texto.
    vencendo: nos.ganhoNaSemana === eles.ganhoNaSemana ? null : (nos.ganhoNaSemana > eles.ganhoNaSemana ? 'nos' : 'eles'),
  };
}
