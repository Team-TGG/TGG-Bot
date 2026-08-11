// Catálogo de ferramentas do `.ia` (usado por handleIa, em admin.js)
import { calcularContribuicaoSemanal, MOTIVOS } from '../services/contribuicaoSemanal.js';
import { selecionarMvpsDasLinhas } from '../services/weeklyMvpService.js';
import { calcularInativosDaSemana, CONTRIBUICAO_MINIMA, LIMIAR_INATIVACAO } from '../services/weeklyInactiveService.js';
import { weeklyMvp as mvpConfig } from '../../config/index.js';

/**
 * O que o `.ia` sabe responder.
 *
 * Cada ferramenta é um par: a **declaração** que vai para a IA (`FERRAMENTAS`, no formato de
 * function calling) e o **executor** que roda no bot (`EXECUTORES`). A IA lê só a declaração e
 * escolhe uma; quem produz número é o executor, chamando as mesmas funções que o cron de quarta
 * usa. Ferramenta nova exige os dois — declaração sem executor vira "não sei responder".
 *
 * O `dados` que cada executor devolve é o que volta para a IA redigir a frase, então leva **só
 * apelido do jogo e números**: `discord_id` e `brawlhalla_id` nunca saem daqui. O free tier do
 * provedor pode usar o conteúdo para treino, e não há motivo para mandar identificador de membro.
 */

const MAX_LINHAS_EMBED = 15;

/** Teto do `limite` que a IA pode pedir: acima disso o campo do embed passa de 1024 caracteres. */
const MAX_LIMITE = 15;

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

export const EXECUTORES = {
  ranking_contribuicao: rankingContribuicao,
  mvps_da_semana: mvpsDaSemana,
  inativos_da_semana: inativosDaSemana,
  contribuicao_de_membro: contribuicaoDeMembro,
};

// ---- Instruções ----

export const INSTRUCAO_ESCOLHA =
  'Você roteia perguntas da staff de uma guilda de Brawlhalla para as funções de um bot. ' +
  'Escolha exatamente uma função e preencha os argumentos a partir da pergunta. ' +
  'Contexto: "contribuição" são guild points ganhos na semana; a semana vai de quinta 06:00 a ' +
  'quarta 06:00; a contribuição mínima exigida de cada membro é ' + CONTRIBUICAO_MINIMA + ' por semana. ' +
  'Se a pergunta citar o nome de uma pessoa, prefira contribuicao_de_membro. ' +
  'Se pedir quantidade de gente abaixo do mínimo ou risco de inativação, use inativos_da_semana. ' +
  'Na dúvida entre ranking e MVP, use ranking_contribuicao.';

export const INSTRUCAO_RESPOSTA =
  'Você responde à staff de uma guilda de Brawlhalla, em português do Brasil. ' +
  'Use SOMENTE os números que vierem no resultado da função. Nunca some, calcule, estime ou ' +
  'complete com conhecimento próprio — se um dado não está no resultado, diga que não tem essa ' +
  'informação. Responda em no máximo 3 frases curtas, direto ao ponto, sem saudação e sem repetir ' +
  'a pergunta. A lista completa já aparece abaixo da sua resposta, então não repita a lista ' +
  'inteira: cite no máximo dois ou três nomes. Se o resultado indicar que a medição é parcial, ' +
  'diga isso. Se uma busca por nome tiver encontrado mais gente do que foi mostrado, diga quantos ' +
  'foram encontrados e peça um nome mais específico.';
