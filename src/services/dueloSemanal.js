import { fetchGuildStats } from '../brawlhalla.js';
import { getGuildWeeklyGuildPoints, getDuelGuildWeeklyGuildPoints } from '../guild.js';
import { guildDuel as config } from '../../config/index.js';
import { pontosSemanaisDaGuilda } from './pontosDaGuilda.js';

/**
 * Placar do duelo da semana: quanto cada guilda ganhou desde a virada de quinta.
 *
 * `guild_points` já é o total da semana e reinicia semanalmente. As capturas guardadas no banco
 * servem para o XP acumulado; subtraí-las dos pontos zeraria ou inverteria o placar após o reset.
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

/**
 * Quanto a **guilda** ganhou nesta semana — o número que aparece no jogo.
 *
 * Não é a soma do que os membros ganharam, e a diferença não é erro: membro pontua a cada partida
 * que avança uma missão, mas a guilda só pontua quando um **tier** da missão fecha (mais as guild
 * battles). Enquanto ninguém fecha o tier seguinte, os membros continuam somando e a guilda não —
 * medido em 12/08/2026: 432.826 do lado dos membros contra 343.497 do lado da guilda.
 *
 * Não depende de captura anterior: zero é uma semana recém-iniciada, não falta de linha de base.
 */
export async function calcularGanhoDaGuildaNaSemana() {
  const api = await fetchGuildStats(config.ourGuildId);
  const pontos = pontosSemanaisDaGuilda(api?.guild_points);

  return {
    nome: api?.name ?? 'Desconhecida',
    membros: api?.member_count ?? null,
    pontosAtuais: pontos,
    ganhoNaSemana: pontos,
  };
}

export async function calcularDueloDaSemana() {
  const [nossaApi, nossaBase, duelo] = await Promise.all([
    fetchGuildStats(config.ourGuildId),
    getGuildWeeklyGuildPoints(),
    getDuelGuildWeeklyGuildPoints(),
  ]);

  if (!duelo) return { motivo: SEM_DUELO.SEM_OPONENTE };
  if (!duelo.guild_id) return { motivo: SEM_DUELO.OPONENTE_SEM_ID };

  const oponenteApi = await fetchGuildStats(duelo.guild_id);

  // Só o XP continua acumulado; sem sua captura não há diferença semanal confiável.
  const lado = (api, baseXp) => ({
    nome: api?.name ?? 'Desconhecida',
    membros: api?.member_count ?? null,
    convite: api?.discord_invite_code ?? null,
    pontosAtuais: pontosSemanaisDaGuilda(api?.guild_points),
    ganhoNaSemana: pontosSemanaisDaGuilda(api?.guild_points),
    xpAtual: api?.xp == null ? null : Number(api.xp),
    xpNaVirada: baseXp == null ? null : Number(baseXp),
    ganhoDeXpNaSemana: api?.xp == null || baseXp == null ? null : Number(api.xp) - Number(baseXp),
  });

  const nos = lado(nossaApi, nossaBase?.total_xp);
  const eles = lado(oponenteApi, duelo.xp);
  if (nos.ganhoNaSemana == null || eles.ganhoNaSemana == null) throw new Error('Pontos semanais da guilda indisponíveis.');

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
