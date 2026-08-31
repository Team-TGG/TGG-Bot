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

// ---- Leaderboard da guilda (usado por handleLbGuilda, o .lb-guilda) ----

export const POR_PAGINA_LB_GUILDA = 14;

export const ORDENS_LB_GUILDA = { TOTAL: 'TOTAL', SEMANAL: 'SEMANAL' };

const RANK_EMOJI = {
  leader: EMOJIS.leaderGuild,
  officer: EMOJIS.officerGuild,
  member: EMOJIS.memberGuild,
  recruit: EMOJIS.recruitGuild,
};

// Nome longo empurra a segunda coluna para baixo e desalinha a grade
const MAX_NOME_LB_GUILDA = 22;

function emojiDoRank(rank) {
  return RANK_EMOJI[String(rank || '').toLowerCase()] ?? EMOJIS.square;
}

function numeroBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

/**
 * Ordena o leaderboard da guilda por total ou por semana.
 *
 * Quem não pôde ser medido na semana (`motivo` preenchido) vai para o fim em vez de valer 0 —
 * senão a base não registrada de um membro ativo o jogaria para o rodapé junto de quem não jogou.
 * Dentro desse grupo o desempate é o total, para a ordem não sair aleatória.
 */
export function ordenarLbGuilda(linhas, ordem) {
  const copia = [...linhas];

  if (ordem === ORDENS_LB_GUILDA.SEMANAL) {
    return copia.sort((a, b) => {
      if (!!a.motivo !== !!b.motivo) return a.motivo ? 1 : -1;
      if (a.motivo && b.motivo) return (b.pontosTotais ?? 0) - (a.pontosTotais ?? 0);
      return b.contribuicao - a.contribuicao;
    });
  }

  return copia.sort((a, b) => {
    // Total desconhecido vai para o fim, pelo mesmo motivo: não é o mesmo que ter zero
    if ((a.pontosTotais == null) !== (b.pontosTotais == null)) return a.pontosTotais == null ? 1 : -1;
    return (b.pontosTotais ?? 0) - (a.pontosTotais ?? 0);
  });
}

function campoDoMembroLbGuilda(linha, posicao, ordem, mvp) {
  const nome = linha.nome.length > MAX_NOME_LB_GUILDA
    ? `${linha.nome.slice(0, MAX_NOME_LB_GUILDA - 1)}…`
    : linha.nome;

  const semana = linha.motivo ? '—' : `**${numeroBR(linha.contribuicao)}**`;
  const total = linha.pontosTotais == null ? '—' : `**${numeroBR(linha.pontosTotais)}**`;

  // A linha da ordenação em uso vai primeiro, para a coluna que o usuário está lendo ficar alinhada
  const valor = ordem === ORDENS_LB_GUILDA.SEMANAL
    ? [`📈 ${semana} na semana`, `🏛️ ${total} no total`]
    : [`🏛️ ${total} no total`, `📈 ${semana} na semana`];

  // Mesmo vocabulário do anúncio da quarta: número para quem ocupa vaga, ⭐ para staff
  if (mvp) valor.push(mvp.posicao ? `🏅 MVP **${mvp.posicao}º**` : '🏅 MVP ⭐ staff');

  return {
    name: `${posicao}. ${emojiDoRank(linha.rankNoJogo)} ${nome}`,
    value: valor.join('\n'),
    inline: true,
  };
}

/**
 * Bloco do próprio usuário, no topo de toda página.
 *
 * Sem ele, responder "estou dentro do MVP?" é caçar o próprio nome em 15 páginas. A posição
 * acompanha a ordenação em uso, mas a elegibilidade é sempre da semana: quem decide é a regra da
 * quarta 06:00, não a coluna que está sendo olhada.
 */
function destaqueLbGuilda({ linha, posicao, totalLinhas, ordem, mvp, falta }) {
  if (!linha) {
    return '📍 Você não aparece neste ranking — é preciso ter cadastro no bot **e** estar na guilda do jogo.';
  }

  const semana = linha.motivo ? '—' : numeroBR(linha.contribuicao);
  const total = linha.pontosTotais == null ? '—' : numeroBR(linha.pontosTotais);

  // A coluna da ordenação em uso vem em negrito, para bater com o que a lista abaixo está mostrando
  const valores = ordem === ORDENS_LB_GUILDA.SEMANAL
    ? `📈 **${semana}** na semana • 🏛️ ${total} no total`
    : `🏛️ **${total}** no total • 📈 ${semana} na semana`;

  const texto = [`📍 **Você** — ${posicao}º de ${totalLinhas} • ${valores}`];

  if (mvp) {
    texto.push(mvp.posicao
      ? `🏅 Elegível ao MVP da semana, na **${mvp.posicao}ª vaga**.`
      : '🏅 Elegível ao MVP da semana — staff, leva o cargo sem ocupar vaga.');

  } else if (linha.motivo) {
    // Sem contribuição medida não existe distância até o corte, e um número aqui viraria promessa
    texto.push('⚠️ Fora do MVP: sua contribuição da semana não pôde ser medida.');

  } else if (falta?.alvo === 'VAGA') {
    texto.push(`⬆️ Fora do MVP: faltam **${numeroBR(falta.faltam)}** de contribuição para passar a última vaga.`);

  } else if (falta) {
    texto.push(`⬆️ Fora do MVP: faltam **${numeroBR(falta.faltam)}** de contribuição para entrar na contagem.`);
  }

  return texto.join('\n');
}

/**
 * Uma página do leaderboard da guilda, em duas colunas de sete.
 *
 * `mvpPorId` é o mapa discordId → `{ posicao }` de quem está elegível ao MVP da semana, montado com
 * a regra do cron (`selecionarMvpsDasLinhas`). A marca aparece nas duas ordenações: elegibilidade é
 * da semana, não da coluna que está sendo olhada.
 */
export function embedLbGuilda({ linhas, pagina, ordem, weekStart, totalPaginas, mvpPorId, destaque }) {
  const inicio = (pagina - 1) * POR_PAGINA_LB_GUILDA;
  const daPagina = linhas.slice(inicio, inicio + POR_PAGINA_LB_GUILDA);

  const campos = [];

  daPagina.forEach((linha, i) => {
    campos.push(campoDoMembroLbGuilda(linha, inicio + i + 1, ordem, mvpPorId?.get(linha.discordId)));
    // O Discord empacota 3 campos inline por fileira; o campo vazio força a quebra em 2 colunas
    if (i % 2 === 1) campos.push({ name: '​', value: '​', inline: true });
  });

  // As duas colunas ficam sem dado por motivos diferentes, e juntar os dois números numa nota só
  // faria parecer que a API está falhando com a guilda toda. O total falta quando a rota devolve o
  // registro incompleto; a semana falta quando ninguém gravou a base da conta.
  const semTotal = linhas.filter(l => l.pontosTotais == null).length;
  const semSemana = linhas.filter(l => l.motivo).length;

  const nota = ordem === ORDENS_LB_GUILDA.SEMANAL
    ? semSemana && `\`—\` na semana = base não gravada para a conta (${semSemana} de ${linhas.length}); ` +
      'sem ela não dá para medir o ganho.'
    : semTotal && `\`—\` no total = a API devolveu o registro incompleto (${semTotal} de ${linhas.length}).`;

  // A elegibilidade é uma prévia: quem está marcado leva o cargo se a semana fechar agora
  const notaMvp = mvpPorId?.size
    ? `🏅 = elegível ao MVP da semana (${mvpPorId.size} hoje), pela regra da quarta 06:00. ` +
      '⭐ = staff, leva o cargo sem ocupar vaga.'
    : null;

  const bloco = destaque ? destaqueLbGuilda({ ...destaque, ordem, totalLinhas: linhas.length }) : null;

  const descricao = [
    bloco ? `${bloco}\n` : null,
    ordem === ORDENS_LB_GUILDA.SEMANAL
      ? '📈 Ordenado pelos **guild points desta semana**.'
      : '🏛️ Ordenado pelos **guild points totais**.',
    `Semana de missões iniciada em ${String(weekStart).slice(0, 10).split('-').reverse().join('/')}.`,
    notaMvp ? `\n${notaMvp}` : null,
    nota ? `${notaMvp ? '' : '\n'}${nota}` : null,
  ].filter(Boolean).join('\n');

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🏆 Leaderboard da Guilda')
    .setDescription(descricao)
    .addFields(campos)
    .setFooter({ text: `Página ${pagina}/${totalPaginas} • ${linhas.length} membros cadastrados` })
    .setTimestamp();
}