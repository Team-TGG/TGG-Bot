// Catálogo de ferramentas do `.ia` (usado por handleIa, em admin.js)
import { calcularContribuicaoSemanal, MOTIVOS } from '../services/contribuicaoSemanal.js';
import { selecionarMvpsDasLinhas } from '../services/weeklyMvpService.js';
import { calcularInativosDaSemana, CONTRIBUICAO_MINIMA, LIMIAR_INATIVACAO } from '../services/weeklyInactiveService.js';
import { calcularDueloDaSemana, SEM_DUELO } from '../services/dueloSemanal.js';
import { getMissionWeekStart, getMissionWeekStartDateTime, getWeeklyInitial, getMovimentacaoDesde, getCadastroPorBrawlhallaIds, loadAliases, resolveBrawlhallaId, formatDateTime } from '../db.js';
import { fetchPlayerStats } from '../brawlhalla.js';
import { calculateGames } from './publicHandlers.js';
import { weeklyMvp as mvpConfig } from '../../config/index.js';

/**
 * O que o `.ia` sabe responder.
 *
 * Cada ferramenta é um par: a **declaração** que vai para a IA (`FERRAMENTAS`, no formato de
 * function calling) e o **executor** que roda no bot (`EXECUTORES`). A IA lê só a declaração e
 * escolhe uma; quem produz número é o executor, chamando as mesmas funções que o cron de quarta
 * usa. Ferramenta nova exige os dois — declaração sem executor vira "não sei responder".
 *
 * `nao_sei_responder` é a exceção, e é declaração sem executor de propósito: o roteador roda com
 * `mode: 'ANY'`, que **obriga** o modelo a escolher uma ferramenta, então sem uma saída de escape
 * toda pergunta fora do catálogo cai numa ferramenta errada e vira resposta confiante e errada
 * (medido em 11/08/2026: 6 de 6 — "quem tem mais TGG Coins?" caiu em `ranking_contribuicao`).
 *
 * O `dados` que cada executor devolve é o que volta para a IA redigir a frase, então leva **só
 * apelido do jogo e números**: `discord_id` e `brawlhalla_id` nunca saem daqui. O free tier do
 * provedor pode usar o conteúdo para treino, e não há motivo para mandar identificador de membro.
 */

const MAX_LINHAS_EMBED = 15;

/** Teto do `limite` que a IA pode pedir: acima disso o campo do embed passa de 1024 caracteres. */
const MAX_LIMITE = 15;

/** Teto da janela de movimentação. Acima de um mês a lista deixa de responder "e essa semana?". */
const MAX_DIAS_MOVIMENTACAO = 30;

function numeroBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

function dataBR(weekStart) {
  const [ano, mes, dia] = String(weekStart).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Mensuráveis: quem tem número de verdade. Motivo preenchido é "não sei", não é zero. */
function medidas(linhas) {
  return linhas.filter(l => !l.motivo);
}

function listaEmEmbed(itens) {
  if (!itens.length) return '_Ninguém._';
  return itens.slice(0, MAX_LINHAS_EMBED).join('\n');
}

// ---- Declarações (o que a IA enxerga) ----

export const FERRAMENTAS = [
  {
    name: 'ranking_contribuicao',
    description:
      'Ranking de contribuição da semana corrente (guild points ganhos desde quinta 06:00). ' +
      'Use para perguntas sobre quem contribuiu mais ou menos, quem está no topo, quem está no ' +
      'fim da lista, e para qualquer pedido de ranking ou leaderboard da semana.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ordem: {
          type: 'STRING',
          enum: ['maior', 'menor'],
          description: 'maior = quem contribuiu mais; menor = quem contribuiu menos. Padrão: maior.',
        },
        limite: {
          type: 'INTEGER',
          description: `Quantos membros listar, de 1 a ${MAX_LIMITE}. Padrão: 10.`,
        },
      },
    },
  },
  {
    name: 'mvps_da_semana',
    description:
      'Quem está elegível ao cargo de MVP da semana neste momento. Use para perguntas sobre MVP, ' +
      'sobre quem vai ganhar o cargo, ou sobre quem está dentro do top de contribuição. É prévia: ' +
      'vale se a semana fechasse agora.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'inativos_da_semana',
    description:
      'Situação da inativação: quantos membros estão abaixo da contribuição mínima e quantos ' +
      'seriam de fato marcados como inativos (staff e blindados não são). Use para perguntas ' +
      'sobre inativos, sobre quem está abaixo do mínimo, e sobre quem corre risco de ser marcado.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'jogos_de_membro',
    description:
      'Quantas partidas um membro jogou na semana e no total, com a divisão entre ranked 1v1, ' +
      '2v2, 3v3 e casual, junto da contribuição dele. Use para perguntas sobre jogos, partidas, ' +
      'quanto alguém jogou, ou para comparar o quanto joga com o quanto contribui.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: { type: 'STRING', description: 'Apelido do membro no Brawlhalla, ou parte dele.' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'movimentacao_da_guilda',
    description:
      'Quem entrou, saiu, foi promovido ou rebaixado na guilda do jogo, com o que ainda falta ' +
      'fazer no cadastro do bot. Use para perguntas sobre entradas, saídas, promoções, ' +
      'rebaixamentos, tamanho do movimento da guilda ou quem é novo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        dias: {
          type: 'INTEGER',
          description: `Quantos dias olhar para trás, de 1 a ${MAX_DIAS_MOVIMENTACAO}. Padrão: desde o começo da semana de missões.`,
        },
      },
    },
  },
  {
    name: 'duelo_da_semana',
    description:
      'Placar do duelo semanal de guildas: contra quem a TGG joga, quanto cada lado ganhou de ' +
      'guild points na semana e quem está na frente. Use para perguntas sobre duelo, rival, ' +
      'guilda adversária ou quem está ganhando.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    // De propósito sem executor: `handleIa` trata ferramenta sem executor como "não sei responder",
    // que é exatamente a resposta certa aqui. Dar um executor a ela é desfazer o efeito.
    name: 'nao_sei_responder',
    description:
      'Use quando a pergunta não for sobre contribuição da semana, MVP, inativação, jogos de um ' +
      'membro, movimentação da guilda nem o duelo semanal. Exemplos: elo e ranked, TGG Coins, ' +
      'loja, missões cadastradas, blindagens, aniversários, punições, qualquer assunto fora dessa ' +
      'lista. É melhor dizer que não sabe do que responder outra coisa.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'contribuicao_de_membro',
    description:
      'Contribuição da semana e posição no ranking de um membro específico, buscado pelo apelido ' +
      'no jogo. Use quando a pergunta cita o nome de uma pessoa.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: {
          type: 'STRING',
          description: 'Apelido do membro no Brawlhalla, ou parte dele.',
        },
      },
      required: ['nome'],
    },
  },
];

// ---- Executores (quem produz o número) ----

async function rankingContribuicao({ ordem = 'maior', limite = 10 }) {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();

  const medidos = medidas(linhas);
  const quantos = Math.min(Math.max(Number(limite) || 10, 1), MAX_LIMITE);
  const crescente = String(ordem).toLowerCase() === 'menor';

  const ordenados = [...medidos].sort((a, b) => crescente
    ? a.contribuicao - b.contribuicao
    : b.contribuicao - a.contribuicao);

  const escolhidos = ordenados.slice(0, quantos);

  return {
    dados: {
      semana: dataBR(weekStart),
      ordem: crescente ? 'menor contribuição primeiro' : 'maior contribuição primeiro',
      total_de_membros_medidos: medidos.length,
      sem_medicao: linhas.length - medidos.length,
      membros: escolhidos.map((l, i) => ({
        posicao: i + 1,
        nome: l.nome,
        contribuicao_na_semana: l.contribuicao,
      })),
    },
    titulo: crescente ? '📉 Menores contribuições da semana' : '📈 Maiores contribuições da semana',
    campos: [{
      name: `Top ${escolhidos.length}`,
      value: listaEmEmbed(escolhidos.map((l, i) =>
        `**${i + 1}.** ${l.nome} — ${numeroBR(l.contribuicao)}`)),
    }],
    rodape: `Semana de ${dataBR(weekStart)} • ${medidos.length} membros medidos`,
  };
}

async function mvpsDaSemana() {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();

  // Mesmo filtro do `.lb-guilda`: quem saiu da guilda do jogo não disputa vaga
  const naGuilda = linhas.filter(l => l.motivo !== MOTIVOS.FORA_DA_GUILDA);
  const { mvps } = selecionarMvpsDasLinhas(naGuilda);

  return {
    dados: {
      semana: dataBR(weekStart),
      previa: true,
      vagas: mvpConfig.limite,
      observacao: 'Staff recebe o cargo sem ocupar vaga (posicao nula).',
      mvps: mvps.map(m => ({
        posicao: m.posicao,
        nome: m.nome,
        contribuicao_na_semana: m.contribuicao,
        staff_sem_ocupar_vaga: m.posicao === null,
      })),
    },
    titulo: '🏅 MVPs da semana (prévia)',
    campos: [{
      name: `${mvps.length} com o cargo se a semana fechasse agora`,
      value: listaEmEmbed(mvps.map(m =>
        `${m.posicao ? `**${m.posicao}º**` : '⭐'} ${m.nome} — ${numeroBR(m.contribuicao)}`)),
    }],
    rodape: `Semana de ${dataBR(weekStart)} • ⭐ = staff, não ocupa vaga • ${mvpConfig.limite} vagas`,
  };
}

async function inativosDaSemana() {
  const { weekStart, inativos, poupados, fechada } = await calcularInativosDaSemana();

  const contagem = (motivo) => poupados.filter(p => p.motivoPoupado === motivo).length;

  // "Abaixo do mínimo" e "seria inativado" são perguntas diferentes: a segunda já desconta staff,
  // blindado e a tolerância. Devolver os dois evita a IA apresentar um como se fosse o outro.
  const abaixoDoMinimo = [...inativos, ...poupados]
    .filter(l => !l.motivo && l.contribuicao < CONTRIBUICAO_MINIMA).length;

  return {
    dados: {
      semana: dataBR(weekStart),
      medicao_definitiva: fechada,
      observacao: fechada
        ? 'A semana fechou: estes números são os definitivos.'
        : 'A semana ainda está aberta, então os números são parciais e ainda podem subir.',
      contribuicao_minima: CONTRIBUICAO_MINIMA,
      corte_com_tolerancia: LIMIAR_INATIVACAO,
      abaixo_da_contribuicao_minima: abaixoDoMinimo,
      seriam_marcados_como_inativos: inativos.length,
      poupados_por_estarem_na_tolerancia: contagem('TOLERANCIA'),
      poupados_por_blindagem: contagem('BLINDADO'),
      poupados_por_serem_staff: contagem('STAFF'),
      poupados_por_ja_estarem_na_lista: contagem('JA_NA_LISTA'),
      sem_medicao_possivel: poupados.filter(p => p.motivo).length,
      membros: inativos.map(l => ({ nome: l.nome, contribuicao_na_semana: l.contribuicao })),
    },
    titulo: '⚠️ Inativação da semana',
    campos: [
      {
        name: 'Contagem',
        value:
          `Abaixo dos ${numeroBR(CONTRIBUICAO_MINIMA)}: **${abaixoDoMinimo}**\n` +
          `Seriam marcados: **${inativos.length}**\n` +
          `Salvos pela tolerância (${numeroBR(LIMIAR_INATIVACAO)}): **${contagem('TOLERANCIA')}**\n` +
          `Blindados: **${contagem('BLINDADO')}** • Staff: **${contagem('STAFF')}**\n` +
          `Sem medição: **${poupados.filter(p => p.motivo).length}**`,
        inline: true,
      },
      {
        name: 'Quem seria marcado',
        value: listaEmEmbed(inativos.map(l => `${l.nome} — ${numeroBR(l.contribuicao)}`)),
        inline: true,
      },
    ],
    rodape: fechada
      ? `Semana de ${dataBR(weekStart)} • medição definitiva`
      : `Semana de ${dataBR(weekStart)} • parcial, a semana só fecha na quarta 06:00`,
  };
}

async function contribuicaoDeMembro({ nome }) {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();

  const busca = String(nome || '').trim().toLowerCase();
  const achados = linhas.filter(l => l.nome.toLowerCase().includes(busca));

  if (!achados.length) {
    return {
      dados: { semana: dataBR(weekStart), procurado: nome, encontrado: false },
      titulo: '🔍 Membro não encontrado',
      campos: [{ name: 'Procurado', value: `\`${nome}\`` }],
      rodape: `Semana de ${dataBR(weekStart)}`,
    };
  }

  // Posição só faz sentido entre quem tem número; quem não pôde ser medido fica sem
  const ranking = medidas(linhas).sort((a, b) => b.contribuicao - a.contribuicao);
  const posicaoDe = (linha) => {
    const i = ranking.findIndex(r => r.brawlhallaId === linha.brawlhallaId);
    return i === -1 ? null : i + 1;
  };

  const detalhes = achados.slice(0, MAX_LINHAS_EMBED).map(l => ({
    nome: l.nome,
    contribuicao_na_semana: l.motivo ? null : l.contribuicao,
    posicao_no_ranking: posicaoDe(l),
    guild_points_totais: l.pontosTotais,
    motivo_sem_medicao: l.motivo,
  }));

  return {
    dados: {
      semana: dataBR(weekStart),
      procurado: nome,
      encontrado: true,
      total_de_membros_medidos: ranking.length,
      // Busca curta casa com meio mundo. Sem esta contagem a IA leria os 15 de `resultados` como
      // se fossem todos e diria "encontrei 15" quando o certo é pedir um nome mais específico.
      total_encontrado: achados.length,
      resultados_mostrados: detalhes.length,
      resultados: detalhes,
    },
    titulo: achados.length > 1 ? `🔍 ${achados.length} membros encontrados` : '🔍 Contribuição do membro',
    campos: [{
      name: detalhes.length < achados.length
        ? `Mostrando ${detalhes.length} de ${achados.length}`
        : 'Resultado',
      value: listaEmEmbed(detalhes.map(d => d.motivo_sem_medicao
        ? `**${d.nome}** — sem medição (${d.motivo_sem_medicao})`
        : `**${d.nome}** — ${numeroBR(d.contribuicao_na_semana)} (${d.posicao_no_ranking}º)`)),
    }],
    rodape: `Semana de ${dataBR(weekStart)}`,
  };
}

/**
 * Jogos são da conta **principal** (`alt_ids`), contribuição é da conta que está na guilda — a
 * mesma divisão do `.scan` e do dossiê de blindagem. Juntar as duas medidas numa resposta só é o
 * ponto da ferramenta: quem joga muito e contribui pouco está jogando fora de missão.
 */
async function jogosDeMembro({ nome }) {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();

  const busca = String(nome || '').trim().toLowerCase();
  const achados = linhas.filter(l => l.nome.toLowerCase().includes(busca));

  if (!achados.length) {
    return {
      dados: { semana: dataBR(weekStart), procurado: nome, encontrado: false },
      titulo: '🔍 Membro não encontrado',
      campos: [{ name: 'Procurado', value: `\`${nome}\`` }],
      rodape: `Semana de ${dataBR(weekStart)}`,
    };
  }

  // Cada membro custa uma chamada à API de stats, então busca ampla pede nome melhor em vez de
  // consultar todo mundo que casou.
  if (achados.length > 1) {
    return {
      dados: {
        semana: dataBR(weekStart),
        procurado: nome,
        encontrado: true,
        total_encontrado: achados.length,
        observacao: 'Mais de um membro casou com a busca. É preciso um nome mais específico.',
        nomes: achados.slice(0, MAX_LINHAS_EMBED).map(l => l.nome),
      },
      titulo: `🔍 ${achados.length} membros encontrados`,
      campos: [{ name: 'Qual deles?', value: listaEmEmbed(achados.map(l => l.nome)) }],
      rodape: `Semana de ${dataBR(weekStart)}`,
    };
  }

  const membro = achados[0];

  await loadAliases().catch(() => {});
  const idJogo = resolveBrawlhallaId(membro.brawlhallaId);

  const [stats, base] = await Promise.all([
    fetchPlayerStats(idJogo).catch((err) => {
      console.warn(`[IA] stats indisponíveis para ${idJogo}: ${err.message}`);
      return null;
    }),
    getWeeklyInitial(idJogo, getMissionWeekStartDateTime()).catch(() => null),
  ]);

  const jogos = stats && base ? calculateGames(stats, stats.ranked, base) : null;

  return {
    dados: {
      semana: dataBR(weekStart),
      nome: membro.nome,
      jogos_totais: stats?.games ?? null,
      jogos_na_semana: jogos?.totalGames ?? null,
      ranked_1v1_na_semana: jogos?.games1v1 ?? null,
      ranked_2v2_na_semana: jogos?.games2v2 ?? null,
      ranked_3v3_na_semana: jogos?.games3v3 ?? null,
      casual_na_semana: jogos?.casualGames ?? null,
      contribuicao_na_semana: membro.motivo ? null : membro.contribuicao,
      motivo_sem_contribuicao: membro.motivo,
      motivo_sem_jogos: jogos ? null : (stats ? 'Sem linha de base da semana' : 'API do Brawlhalla indisponível'),
    },
    titulo: `🎮 Jogos de ${membro.nome}`,
    campos: [
      {
        name: 'Na semana',
        value: jogos
          ? `**${numeroBR(jogos.totalGames)}** partidas\n` +
            `1v1: ${numeroBR(jogos.games1v1)} • 2v2: ${numeroBR(jogos.games2v2)} • 3v3: ${numeroBR(jogos.games3v3)}\n` +
            `Casual: ${numeroBR(jogos.casualGames)}`
          : '_Indisponível._',
        inline: true,
      },
      {
        name: 'Contribuição',
        value: membro.motivo
          ? `_Sem medição (${membro.motivo})._`
          : `**${numeroBR(membro.contribuicao)}** guild points`,
        inline: true,
      },
    ],
    rodape: `Semana de ${dataBR(weekStart)} • ${numeroBR(stats?.games ?? 0)} jogos no total`,
  };
}

/**
 * Movimentação na guilda do jogo. O cruzamento com o cadastro é o que interessa à staff: quem saiu
 * e continua `active` segue contando em sync, missão e inativação, e quem entrou sem `.entrou`
 * ainda não existe para o bot.
 */
async function movimentacaoDaGuilda({ dias }) {
  const usouJanela = Number.isFinite(Number(dias)) && Number(dias) > 0;
  const quantosDias = Math.min(Math.max(Number(dias) || 0, 1), MAX_DIAS_MOVIMENTACAO);

  const desde = usouJanela
    ? formatDateTime(new Date(Date.now() - quantosDias * 24 * 3600 * 1000))
    : getMissionWeekStart();

  const eventos = await getMovimentacaoDesde(desde);
  const cadastro = await getCadastroPorBrawlhallaIds([...new Set(eventos.map(e => String(e.brawlhalla_id)))]);

  const por = (acao) => eventos.filter(e => e.action === acao);

  const semCadastro = por('entrou').filter(e => !cadastro.get(String(e.brawlhalla_id)));
  const saiuAtivo = por('saiu').filter(e => cadastro.get(String(e.brawlhalla_id))?.active);

  const resumo = (acao) => por(acao).map(e => ({ nome: e.nome, quando: String(e.occurred_at).slice(0, 10), rank: e.rank ?? null }));

  return {
    dados: {
      desde: dataBR(desde),
      periodo: usouJanela ? `últimos ${quantosDias} dias` : 'semana de missões corrente',
      entraram: por('entrou').length,
      sairam: por('saiu').length,
      promovidos: por('promovido').length,
      rebaixados: por('rebaixado').length,
      // As duas pendências que geram trabalho para a staff
      entraram_sem_cadastro_no_bot: semCadastro.map(e => e.nome),
      sairam_e_continuam_ativos_no_cadastro: saiuAtivo.map(e => e.nome),
      lista_entraram: resumo('entrou').slice(0, MAX_LINHAS_EMBED),
      lista_sairam: resumo('saiu').slice(0, MAX_LINHAS_EMBED),
      lista_promovidos: resumo('promovido').slice(0, MAX_LINHAS_EMBED),
      lista_rebaixados: resumo('rebaixado').slice(0, MAX_LINHAS_EMBED),
    },
    titulo: '🔄 Movimentação da guilda',
    campos: [
      {
        name: 'Contagem',
        value:
          `📥 Entraram: **${por('entrou').length}**\n` +
          `🚪 Saíram: **${por('saiu').length}**\n` +
          `⬆️ Promovidos: **${por('promovido').length}**\n` +
          `⬇️ Rebaixados: **${por('rebaixado').length}**`,
        inline: true,
      },
      {
        name: 'Pendências',
        value:
          `Falta \`.entrou\`: **${semCadastro.length}**\n` +
          `Saiu e continua ativo: **${saiuAtivo.length}**`,
        inline: true,
      },
      {
        name: 'Entradas e saídas',
        value: listaEmEmbed([
          ...por('entrou').map(e => `📥 ${e.nome}`),
          ...por('saiu').map(e => `🚪 ${e.nome}`),
        ]),
      },
    ],
    rodape: `Desde ${dataBR(desde)} • ${eventos.length} eventos`,
  };
}

async function dueloDaSemana() {
  const duelo = await calcularDueloDaSemana();

  if (duelo.motivo) {
    return {
      dados: {
        tem_duelo: false,
        motivo: duelo.motivo === SEM_DUELO.SEM_OPONENTE
          ? 'Nenhuma guilda rival cadastrada para esta semana.'
          : 'A guilda rival da semana está cadastrada sem guild_id.',
      },
      titulo: '⚔️ Sem duelo cadastrado',
      campos: [{ name: 'Motivo', value: 'O cron de quarta 07:00 não cadastrou o oponente desta semana.' }],
      rodape: 'Duelo semanal de guildas',
    };
  }

  const { nos, eles } = duelo;
  const quem = duelo.vencendo === 'nos' ? nos.nome : duelo.vencendo === 'eles' ? eles.nome : null;

  return {
    dados: {
      tem_duelo: true,
      nossa_guilda: nos.nome,
      guilda_adversaria: eles.nome,
      nossos_pontos_na_semana: nos.ganhoNaSemana,
      pontos_do_adversario_na_semana: eles.ganhoNaSemana,
      diferenca: duelo.diferenca,
      quem_esta_vencendo: quem ?? 'empate',
      nossos_membros: nos.membros,
      membros_do_adversario: eles.membros,
      // Guild points acumulam: o que vale é o ganho da semana, não o total
      observacao: 'O placar é o ganho desde a virada de quinta, não o total acumulado de cada guilda.',
    },
    titulo: '⚔️ Duelo da semana',
    campos: [
      {
        name: nos.nome,
        value: `🔥 **${numeroBR(nos.ganhoNaSemana)}** na semana\n👥 ${nos.membros} membros`,
        inline: true,
      },
      {
        name: eles.nome,
        value: `🔥 **${numeroBR(eles.ganhoNaSemana)}** na semana\n👥 ${eles.membros} membros`,
        inline: true,
      },
      {
        name: 'Placar',
        value: quem ? `🏆 **${quem}** na frente por ${numeroBR(duelo.diferenca)}` : '🤝 Empate',
      },
    ],
    rodape: 'Ganho desde quinta 06:00 • mesmo cálculo do .duel',
  };
}

export const EXECUTORES = {
  ranking_contribuicao: rankingContribuicao,
  mvps_da_semana: mvpsDaSemana,
  inativos_da_semana: inativosDaSemana,
  contribuicao_de_membro: contribuicaoDeMembro,
  jogos_de_membro: jogosDeMembro,
  movimentacao_da_guilda: movimentacaoDaGuilda,
  duelo_da_semana: dueloDaSemana,
};

// ---- Instruções ----

export const INSTRUCAO_ESCOLHA =
  'Você roteia perguntas da staff de uma guilda de Brawlhalla para as funções de um bot. ' +
  'Escolha exatamente uma função e preencha os argumentos a partir da pergunta. ' +
  'Contexto: "contribuição" são guild points ganhos na semana; a semana vai de quinta 06:00 a ' +
  'quarta 06:00; a contribuição mínima exigida de cada membro é ' + CONTRIBUICAO_MINIMA + ' por semana. ' +
  // A regra do nome vem primeiro e diz "mesmo que", porque "fulano corre risco de ser inativado?"
  // casa com as duas: sem a precedência explícita o modelo responde a contagem da guilda inteira
  // para uma pergunta sobre uma pessoa (medido em 11/08/2026).
  'Pergunta que cita o nome de uma pessoa é sempre sobre ela, mesmo que fale de inativação ou de ' +
  'risco: use jogos_de_membro se for sobre partidas jogadas e contribuicao_de_membro no resto. ' +
  'inativos_da_semana é só para contagem da guilda inteira, sem nome de ninguém. ' +
  'Na dúvida entre ranking e MVP, use ranking_contribuicao. ' +
  'Se nenhuma função responder a pergunta, use nao_sei_responder em vez de escolher a mais parecida.';

export const INSTRUCAO_RESPOSTA =
  'Você responde à staff de uma guilda de Brawlhalla, em português do Brasil. ' +
  'Use SOMENTE os números que vierem no resultado da função. Nunca some, calcule, estime ou ' +
  'complete com conhecimento próprio — se um dado não está no resultado, diga que não tem essa ' +
  'informação. Responda em no máximo 3 frases curtas, direto ao ponto, sem saudação e sem repetir ' +
  'a pergunta. A lista completa já aparece abaixo da sua resposta, então não repita a lista ' +
  'inteira: cite no máximo dois ou três nomes. Se o resultado indicar que a medição é parcial, ' +
  'diga isso. Se uma busca por nome tiver encontrado mais gente do que foi mostrado, diga quantos ' +
  'foram encontrados e peça um nome mais específico.';
