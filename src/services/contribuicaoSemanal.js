import { getActiveUsersWithBrawlhallaId, getMissionWeekStart } from '../db.js';
import { getPlayerMissionProgress } from '../tggCoins.js';
import { fetchGuildMembersNewAPI } from '../brawlhalla.js';

/**
 * Contribuição da semana de cada membro ativo — a base do MVP semanal e da inativação.
 *
 * Contribuição é sempre diferença entre duas capturas: `player_weekly_info.guild_points`
 * (linha de base da quinta 06:00) contra o valor atual da rota em lote /v1/guild/members.
 * Alt não entra: as duas rotinas medem a conta que está na guilda.
 *
 * Quem não pôde ser medido volta com `motivo` preenchido em vez de sumir da lista — 0 e "não sei"
 * são coisas diferentes, e tratar os dois como 0 daria MVP a quem não jogou e inativaria quem jogou.
 */

/** Contas que não puderam ser medidas, e por quê. */
export const MOTIVOS = {
  FORA_DA_GUILDA: 'FORA_DA_GUILDA',
  SEM_BASE: 'SEM_BASE',
  BASE_ZERADA: 'BASE_ZERADA',
};

/**
 * Função pura: recebe o que já foi lido do banco e da API e devolve uma linha por membro.
 * Dá para conferir o cálculo inteiro sem tocar em nada.
 */
export function calcularContribuicoes({ users, baseByAccount, membrosDaGuilda, inicioSemanaEmSegundos, entradaRecenteEmSegundos }) {
  const linhas = [];

  for (const user of users) {
    const id = String(user.brawlhalla_id);
    const membro = membrosDaGuilda.get(id);

    const entrouNaSemana = !!membro && membro.joinDate > 0 && membro.joinDate >= inicioSemanaEmSegundos;

    const linha = {
      discordId: String(user.discord_id),
      brawlhallaId: id,
      nome: membro?.name || user.username || id,
      role: String(user.role || '').toLowerCase(),
      // Rank do jogo (Leader/Officer/Member/Recruit) — nem sempre bate com o role do banco
      rankNoJogo: membro?.rank ?? null,
      joinDate: membro?.joinDate ?? 0,
      entrouNaSemana,
      contribuicao: 0,
      motivo: null,
    };

    // Saiu da guilda do jogo (ou a conta cadastrada não é a que está nela): sem valor atual
    // não há o que medir.
    if (!membro) {
      linha.motivo = MOTIVOS.FORA_DA_GUILDA;
      linhas.push(linha);
      continue;
    }

    const base = baseByAccount.get(id);

    if (base === null || base === undefined) {
      linha.motivo = MOTIVOS.SEM_BASE;
      linhas.push(linha);
      continue;
    }

    // Base 0 é legítima para quem acabou de entrar na guilda — começou do zero mesmo. A janela é
    // a semana passada inteira, não só esta: quem entrou na terça já pega a captura da quinta com
    // quase nada acumulado (medido em 08/08/2026: os 5 casos de base 0 legítima entraram na
    // véspera da virada). Para quem já estava aqui, 0 quer dizer base não registrada — contar
    // contra esse 0 leria o acumulado inteiro (dezenas de milhares) como ganho da semana.
    const entrouAgora = membro.joinDate > 0 && membro.joinDate >= entradaRecenteEmSegundos;

    if (Number(base) === 0 && membro.points > 0 && !entrouAgora) {
      linha.motivo = MOTIVOS.BASE_ZERADA;
      linhas.push(linha);
      continue;
    }

    linha.contribuicao = Math.max(0, Number(membro.points) - Number(base));
    linhas.push(linha);
  }

  return linhas;
}

/** Lê banco + API e devolve a contribuição da semana corrente de todo membro ativo. */
export async function calcularContribuicaoSemanal() {
  const weekStart = getMissionWeekStart();

  const [users, guildMembers] = await Promise.all([
    getActiveUsersWithBrawlhallaId(),
    fetchGuildMembersNewAPI(),
  ]);

  const membrosDaGuilda = new Map(
    (guildMembers.guild_members ?? []).map(m => [String(m.brawlhalla_id), {
      name: m.name,
      rank: m.rank ?? null,
      points: Number(m.guild_points || 0),
      // join_date separa base 0 legítima (entrou nesta semana) de base 0 não registrada
      joinDate: Number(m.join_date || 0),
    }])
  );

  const accountIds = users.map(u => String(u.brawlhalla_id));
  const baseRows = await getPlayerMissionProgress(accountIds, weekStart);

  const baseByAccount = new Map(
    (baseRows ?? []).map(row => [String(row.brawlhalla_id), row.guild_points])
  );

  // week_start vem como 'YYYY-MM-DD HH:mm:ss'; join_date da API é epoch em segundos
  const inicioSemanaEmSegundos = Math.floor(
    new Date(String(weekStart).replace(' ', 'T')).getTime() / 1000
  );

  const entradaRecenteEmSegundos = inicioSemanaEmSegundos - 7 * 24 * 3600;

  const linhas = calcularContribuicoes({
    users, baseByAccount, membrosDaGuilda, inicioSemanaEmSegundos, entradaRecenteEmSegundos,
  });

  return { weekStart, linhas };
}
