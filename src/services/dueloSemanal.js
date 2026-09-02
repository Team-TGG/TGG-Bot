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

/**
 * Quanto a **guilda** ganhou nesta semana — o número que aparece no jogo.
 *
 * Não é a soma do que os membros ganharam, e a diferença não é erro: membro pontua a cada partida
 * que avança uma missão, mas a guilda só pontua quando um **tier** da missão fecha (mais as guild
 * battles). Enquanto ninguém fecha o tier seguinte, os membros continuam somando e a guilda não —
 * medido em 12/08/2026: 432.826 do lado dos membros contra 343.497 do lado da guilda.
 *
 * A base é a mesma linha que o duelo usa (`guild_weekly_guild_points`, gravada pelo cron de quarta),
 * então sem ela não há o que medir e volta `null` em vez de devolver o acumulado inteiro como ganho.
 */
export async function calcularGanhoDaGuildaNaSemana() {
  const [api, base] = await Promise.all([
    fetchGuildStatsNewAPI(config.ourGuildId),
    getGuildWeeklyGuildPoints(),
  ]);

  const pontosNaVirada = base?.total_guild_points;

  return {
    nome: api?.name ?? 'Desconhecida',
    membros: api?.member_count ?? null,
    pontosAtuais: api?.guild_points == null ? null : Number(api.guild_points),
    pontosNaVirada: pontosNaVirada == null ? null : Number(pontosNaVirada),
    ganhoNaSemana: api?.guild_points == null || pontosNaVirada == null
      ? null
      : Number(api.guild_points) - Number(pontosNaVirada),
  };
}

export async function calcularDueloDaSemana() {
  const [nossaApi, nossaBase, duelo] = await Promise.all([
    fetchGuildStatsNewAPI(config.ourGuildId),
    getGuildWeeklyGuildPoints(),
    getDuelGuildWeeklyGuildPoints(),
  ]);

  if (!duelo) return { motivo: SEM_DUELO.SEM_OPONENTE };
  if (!duelo.guild_id) return { motivo: SEM_DUELO.OPONENTE_SEM_ID };

  const oponenteApi = await fetchGuildStatsNewAPI(duelo.guild_id);

  // XP tem o mesmo desenho dos guild points: o `xp` de /v1/guild/stats acumula desde a
  // atualização de guildas, então o da semana é diferença entre duas capturas. `legacy_xp` fica
  // de fora — é o acumulado da era anterior, congelado, e diferença dele é sempre 0.
  //
  // Base ausente vira `null` e não 0, ao contrário dos pontos acima: semana gravada antes de a
  // coluna existir devolveria o acumulado inteiro (dezenas de milhões) como ganho da semana. Quem
  // monta o embed traduz `null` para "—".
  const lado = (api, base, baseXp) => ({
    nome: api?.name ?? 'Desconhecida',
    membros: api?.member_count ?? null,
    convite: api?.discord_invite_code ?? null,
    pontosAtuais: Number(api?.guild_points || 0),
    pontosNaVirada: Number(base || 0),
    ganhoNaSemana: Number(api?.guild_points || 0) - Number(base || 0),
    xpAtual: api?.xp == null ? null : Number(api.xp),
    xpNaVirada: baseXp == null ? null : Number(baseXp),
    ganhoDeXpNaSemana: api?.xp == null || baseXp == null ? null : Number(api.xp) - Number(baseXp),
  });

  const nos = lado(nossaApi, nossaBase?.total_guild_points, nossaBase?.total_xp);
  const eles = lado(oponenteApi, duelo.guild_points, duelo.xp);

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
