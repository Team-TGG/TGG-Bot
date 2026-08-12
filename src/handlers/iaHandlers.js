// Catálogo de ferramentas do `.ia` (usado por handleIa, em admin.js)
import { calcularContribuicaoSemanal, MOTIVOS } from '../services/contribuicaoSemanal.js';
import { calcularMediasHistoricas, estatisticasDasMedias, GUILD_POINTS_DESDE } from '../services/mediaHistorica.js';
import { selecionarMvpsDasLinhas } from '../services/weeklyMvpService.js';
import { calcularInativosDaSemana, CONTRIBUICAO_MINIMA, LIMIAR_INATIVACAO } from '../services/weeklyInactiveService.js';
import { calcularDueloDaSemana, calcularGanhoDaGuildaNaSemana, SEM_DUELO } from '../services/dueloSemanal.js';
import { getMissionWeekStart, getMissionWeekStartDateTime, getWeeklyInitial, getMovimentacaoDesde, getCadastroPorBrawlhallaIds, getUserByDiscordId, loadAliases, resolveBrawlhallaId, formatDateTime } from '../db.js';
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

/** Teto de linhas do que volta **para a IA** em lista longa. Não é o teto do embed. */
const MAX_LINHAS_EMBED = 15;

/** Teto de um campo de embed no Discord. Passar disso derruba a mensagem inteira. */
const MAX_CARACTERES_CAMPO = 1024;

/** Folga para o "_… e mais 999_" caber depois da última linha que entrou. */
const RESERVA_TRUNCAGEM = 24;

/** Teto do `limite` que a IA pode pedir: acima disso o campo do embed passa de 1024 caracteres. */
const MAX_LIMITE = 15;

/** Teto da janela de movimentação. Acima de um mês a lista deixa de responder "e essa semana?". */
const MAX_DIAS_MOVIMENTACAO = 30;

/**
 * Unidade de todo número de contribuição que sai daqui, dita junto do número.
 *
 * O executor sabe a unidade e a IA não: sem isso ela preenche a lacuna e já chamou guild points de
 * "XP" (12/08/2026), que no Brawlhalla é a medida que **não** conta como contribuição. Vai no
 * `dados` e também em `INSTRUCAO_RESPOSTA`, porque quem redige é uma segunda chamada.
 */
const UNIDADE = 'guild points ganhos nas missões da guilda (não é XP)';

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

/**
 * Como a **semana corrente** está indo, sobre quem pontuou (contribuição > 0).
 *
 * Decisão do usuário (11/08/2026): média sobre a guilda inteira mede quantas contas existem, não
 * como a semana está indo — quem nem abriu o jogo puxa o número para baixo e some no meio da conta.
 *
 * Não é a "média de contribuição" que a staff pergunta: aquela é a de longo prazo, em
 * [mediaHistorica.js](../services/mediaHistorica.js). Esta aqui vai junto do ranking da semana, como
 * contexto de "a semana tá fraca?", e é só disso que ela dá conta.
 */
function estatisticasDaSemana(medidos) {
  const ativos = medidos.filter(l => l.contribuicao > 0);
  const soma = ativos.reduce((total, l) => total + l.contribuicao, 0);
  const media = ativos.length ? Math.round(soma / ativos.length) : 0;

  const ordenados = [...ativos].sort((a, b) => a.contribuicao - b.contribuicao);
  const meio = Math.floor(ordenados.length / 2);
  const mediana = !ordenados.length ? 0
    : ordenados.length % 2 ? ordenados[meio].contribuicao
      : Math.round((ordenados[meio - 1].contribuicao + ordenados[meio].contribuicao) / 2);

  return {
    ativos,
    ordenados,
    zerados: medidos.length - ativos.length,
    soma,
    media,
    mediana,
    // A média sobre todo mundo fica disponível, mas dizendo que o divisor é outro
    mediaGeral: medidos.length ? Math.round(soma / medidos.length) : 0,
    acima: ativos.filter(l => l.contribuicao > media).length,
  };
}

/** Palavras que a IA costuma mandar em `nome` quando a pergunta é sobre quem perguntou. */
const PRIMEIRA_PESSOA = new Set(['eu', 'mim', 'meu', 'minha', 'me', 'eu mesmo', 'eu mesma']);

/**
 * Quem a pergunta é sobre: o nome pedido, ou quem perguntou.
 *
 * `nome` vazio é o caminho normal do "eu" — a declaração manda deixar em branco nesse caso. O
 * conjunto acima existe porque o modelo às vezes preenche com o pronome mesmo assim, e procurar
 * "eu" no apelido casaria com meia guilda (Deiucu, Feijão…).
 *
 * Devolve `{ linhas, achados, sobre }`, com `sobre` dizendo se a busca foi por nome ou pelo autor —
 * quem chama usa isso para escrever "você" em vez de repetir o apelido.
 */
async function encontrarMembro({ nome, linhas, discordId }) {
  const pedido = String(nome ?? '').trim();
  const souEu = !pedido || PRIMEIRA_PESSOA.has(pedido.toLowerCase());

  if (!souEu) {
    const busca = pedido.toLowerCase();
    return { achados: linhas.filter(l => l.nome.toLowerCase().includes(busca)), sobre: 'nome', pedido };
  }

  if (!discordId) return { achados: [], sobre: 'autor', pedido, semContexto: true };

  const user = await getUserByDiscordId(String(discordId)).catch(() => null);

  if (!user?.brawlhalla_id) return { achados: [], sobre: 'autor', pedido, semCadastro: true };

  return {
    achados: linhas.filter(l => l.brawlhallaId === String(user.brawlhalla_id)),
    sobre: 'autor',
    pedido,
  };
}

/** Embed de "não achei", com o motivo certo para cada caminho. */
function membroNaoEncontrado({ weekStart, busca, titulo = '🔍 Membro não encontrado' }) {
  const motivo = busca.semCadastro
    ? 'Quem perguntou não tem Brawlhalla ID cadastrado no bot.'
    : busca.sobre === 'autor'
      ? 'Não deu para identificar quem perguntou.'
      : 'Nenhum membro casou com a busca.';

  return {
    dados: {
      semana: dataBR(weekStart),
      procurado: busca.sobre === 'autor' ? 'quem perguntou' : busca.pedido,
      encontrado: false,
      motivo,
    },
    titulo,
    campos: [{ name: 'Procurado', value: busca.sobre === 'autor' ? '_você_' : `\`${busca.pedido}\`` }],
    rodape: `Semana de ${dataBR(weekStart)}`,
  };
}

/**
 * Lista para campo de embed: enche até o teto do Discord e **diz quantos ficaram de fora**.
 *
 * Era um corte fixo em 15 linhas, calado. A lista de MVP passa disso quase toda semana — 22 em
 * 11/08/2026, 14 com vaga mais 8 da staff, que recebe o cargo sem ocupar vaga — então 7 sumiam
 * sem nenhum sinal de que havia mais, e a resposta parecia completa. Os 22 dão 573 caracteres,
 * bem dentro do teto: o limite de linhas nunca foi o que protegia o campo.
 */
function listaEmEmbed(itens) {
  if (!itens.length) return '_Ninguém._';

  const linhas = [];
  let tamanho = 0;

  for (const item of itens) {
    const custo = item.length + 1; // a quebra de linha entre as entradas
    if (tamanho + custo > MAX_CARACTERES_CAMPO - RESERVA_TRUNCAGEM) break;

    linhas.push(item);
    tamanho += custo;
  }

  const restantes = itens.length - linhas.length;

  return restantes ? `${linhas.join('\n')}\n_… e mais ${restantes}_` : linhas.join('\n');
}

// ---- Declarações (o que a IA enxerga) ----

export const FERRAMENTAS = [
  {
    name: 'ranking_contribuicao',
    description:
      'Ranking de contribuição da semana corrente (guild points ganhos desde quinta 06:00), com o ' +
      'resumo de como a semana está indo: quanto a guilda ganhou, quantos pontuaram, quantos ' +
      'zeraram e quanto foi a contribuição típica. Use para perguntas sobre quem contribuiu mais ou menos ' +
      'nesta semana, quem está no topo ou no fim da lista, qualquer pedido de ranking ou ' +
      'leaderboard da semana, e para saber se a semana está fraca ou forte.',
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
    name: 'media_de_contribuicao',
    description:
      'Média de contribuição por semana de cada membro ao longo de todo o tempo de guilda (guild ' +
      'points totais divididos pelas semanas), com o ranking de quem tem a maior e a menor média. ' +
      'Use para perguntas sobre média de contribuição, quem rende mais ou menos por semana no ' +
      'geral, quem é consistente e quem contribui pouco de forma constante. Não é sobre a semana ' +
      'corrente: para isso use ranking_contribuicao.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ordem: {
          type: 'STRING',
          enum: ['maior', 'menor'],
          description: 'maior = quem tem a maior média; menor = quem tem a menor média. Padrão: maior.',
        },
        limite: {
          type: 'INTEGER',
          description: `Quantos membros listar, de 1 a ${MAX_LIMITE}. Padrão: 10.`,
        },
      },
    },
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
        nome: {
          type: 'STRING',
          description: 'Apelido do membro no Brawlhalla, ou parte dele. ' +
            'Deixe vazio quando a pergunta for sobre quem está perguntando ("eu", "meu", "minha").',
        },
      },
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
      'Contribuição da semana, posição no ranking e média de contribuição por semana de um membro ' +
      'específico, buscado pelo apelido no jogo. Use quando a pergunta cita o nome de uma pessoa, ' +
      'e também quando ela é sobre quem está perguntando ("quanto eu contribuí?", "qual a minha ' +
      'média?", "estou acima da média?").',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: {
          type: 'STRING',
          description: 'Apelido do membro no Brawlhalla, ou parte dele. ' +
            'Deixe vazio quando a pergunta for sobre quem está perguntando ("eu", "meu", "minha").',
        },
      },
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

  // O resumo da semana vem de carona porque sai do mesmo cálculo e responde "a semana tá fraca?",
  // que antes tinha ferramenta só dela. Média de contribuição, sem qualificação, virou a histórica.
  const { ativos, zerados, media, mediana, soma } = estatisticasDaSemana(medidos);

  // A soma dos membros não é o que a guilda ganhou, e é o número da guilda que a staff vê no jogo.
  // Ler o do jogo aqui é o que evita a resposta discordar da tela (relatado em 12/08/2026).
  const guilda = await calcularGanhoDaGuildaNaSemana().catch((err) => {
    console.warn(`[IA] ganho da guilda indisponível: ${err.message}`);
    return null;
  });

  return {
    dados: {
      semana: dataBR(weekStart),
      unidade: UNIDADE,
      ordem: crescente ? 'menor contribuição primeiro' : 'maior contribuição primeiro',
      total_de_membros_medidos: medidos.length,
      sem_medicao: linhas.length - medidos.length,
      pontuaram_nesta_semana: ativos.length,
      zeraram_nesta_semana: zerados,
      media_desta_semana_entre_quem_pontuou: media,
      mediana_desta_semana_entre_quem_pontuou: mediana,
      // Os dois totais vão com o nome dizendo de quem é cada um: só o da guilda é "o total da
      // semana", e é o que aparece no jogo. O dos membros é soma de ganhos individuais.
      ganho_da_guilda_nesta_semana: guilda?.ganhoNaSemana ?? null,
      soma_do_que_os_membros_ganharam: soma,
      por_que_os_dois_totais_diferem: 'Membro pontua a cada partida que avança uma missão, mas a '
        + 'guilda só pontua quando um tier da missão fecha (mais as guild battles). A soma dos '
        + 'membros é normalmente maior e NÃO é o total da guilda. Ao falar do total da semana da '
        + 'guilda, use ganho_da_guilda_nesta_semana.',
      observacao: 'Estes números são só da semana corrente. A média por semana de cada membro ao '
        + 'longo do tempo de guilda é outra coisa, e sai em media_de_contribuicao.',
      membros: escolhidos.map((l, i) => ({
        posicao: i + 1,
        nome: l.nome,
        contribuicao_na_semana: l.contribuicao,
      })),
    },
    titulo: crescente ? '📉 Menores contribuições da semana' : '📈 Maiores contribuições da semana',
    campos: [
      {
        name: `Top ${escolhidos.length}`,
        value: listaEmEmbed(escolhidos.map((l, i) =>
          `**${i + 1}.** ${l.nome} — ${numeroBR(l.contribuicao)}`)),
      },
      {
        name: 'A semana até agora',
        value:
          `Guilda ganhou: **${guilda?.ganhoNaSemana == null ? '—' : numeroBR(guilda.ganhoNaSemana)}**\n` +
          `Soma dos membros: **${numeroBR(soma)}** _(sobe a cada partida; a guilda só no fecha-tier)_\n` +
          `Pontuaram: **${ativos.length}** • Zeraram: **${zerados}**\n` +
          `Média de quem pontuou: **${numeroBR(media)}** • Mediana: **${numeroBR(mediana)}**`,
      },
    ],
    rodape: `Semana de ${dataBR(weekStart)} • ${medidos.length} membros medidos`,
  };
}

/**
 * Tempo mínimo de guilda para entrar no **ranking**. Abaixo disso a média ainda é palpite: uma
 * semana boa ou ruim move o número inteiro, e quem entrou há dias ocupava quase toda a ponta de
 * baixo (medido em 12/08/2026: 51 dos 196 medidos, e 7 dos 8 últimos colocados). Decisão do usuário.
 *
 * O corte é só da lista — a média da guilda continua sobre todo mundo, e a contagem de quem ficou
 * de fora sai no `dados` e no rodapé: lista cortada tem que dizer que foi cortada.
 */
const SEMANAS_PARA_RANKEAR = 4;

/**
 * Média de contribuição **por semana**, ao longo de todo o tempo de guilda — o mesmo número do
 * `.scan`, agora para a guilda inteira e ordenável pelas duas pontas.
 *
 * Cada membro tem o próprio divisor (semanas desde 03/12/2025 ou desde a entrada, o que for mais
 * recente), então `semanas_contadas` sai junto de cada linha: sem ele os 5.000/semana de quem está
 * há um mês parecem a mesma coisa que os 5.000/semana de quem está há oito meses.
 */
async function mediaDeContribuicao({ ordem = 'maior', limite = 10 }) {
  const { linhas } = await calcularMediasHistoricas();

  const comMedia = linhas.filter(l => !l.motivoMedia);
  const { media, mediana, acima, abaixo } = estatisticasDasMedias(comMedia);

  const crescente = String(ordem).toLowerCase() === 'menor';
  const quantos = Math.min(Math.max(Number(limite) || 10, 1), MAX_LIMITE);

  const rankeaveis = comMedia.filter(l => l.semanas >= SEMANAS_PARA_RANKEAR);
  const novatos = comMedia.length - rankeaveis.length;

  const ordenadas = [...rankeaveis].sort((a, b) => crescente ? a.media - b.media : b.media - a.media);
  const lista = ordenadas.slice(0, quantos);

  const desde = GUILD_POINTS_DESDE.toLocaleDateString('pt-BR');

  return {
    dados: {
      o_que_e: `Guild points totais de cada membro divididos pelas semanas desde ${desde}, quando os `
        + 'guild points passaram a existir. Quem entrou depois é dividido pelas semanas desde a entrada.',
      unidade: UNIDADE,
      media_da_guilda: media,
      mediana_da_guilda: mediana,
      membros_com_media: comMedia.length,
      sem_media_possivel: linhas.length - comMedia.length,
      acima_da_media_da_guilda: acima,
      abaixo_da_media_da_guilda: abaixo,
      ponta_listada: crescente ? 'as menores médias' : 'as maiores médias',
      membros_no_ranking: rankeaveis.length,
      fora_do_ranking_por_pouco_tempo_de_guilda: novatos,
      regra_do_ranking: `Só entra na lista quem tem ${SEMANAS_PARA_RANKEAR} semanas ou mais de `
        + 'guilda; com menos que isso a média ainda oscila demais. A média da guilda conta todos.',
      membros: lista.map((l, i) => ({
        posicao: i + 1,
        nome: l.nome,
        media_por_semana: l.media,
        semanas_contadas: Math.round(l.semanas),
        guild_points_totais: l.pontosTotais,
        contagem_desde: l.desdeEntrada ? 'a entrada na guilda' : desde,
      })),
    },
    titulo: crescente ? '📉 Menores médias de contribuição' : '📈 Maiores médias de contribuição',
    campos: [
      {
        name: crescente ? `${lista.length} menores médias` : `${lista.length} maiores médias`,
        value: listaEmEmbed(lista.map((l, i) =>
          `**${i + 1}.** ${l.nome} — ${numeroBR(l.media)}/sem \`${Math.round(l.semanas)}s\``)),
      },
      {
        name: 'A guilda',
        value:
          `Média das médias: **${numeroBR(media)}**\n` +
          `Mediana: **${numeroBR(mediana)}**\n` +
          `Acima da média: **${acima}** • Abaixo: **${abaixo}**\n` +
          `Medidos: **${comMedia.length}** • No ranking: **${rankeaveis.length}**`,
      },
    ],
    rodape: `Média por semana desde ${desde} • \`Ns\` = semanas contadas • `
      + `${novatos} com menos de ${SEMANAS_PARA_RANKEAR} semanas fora da lista`,
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
      unidade: UNIDADE,
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
      unidade: UNIDADE,
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

async function contribuicaoDeMembro({ nome }, contexto = {}) {
  // A média histórica vem junto porque "qual a minha média?" e "eu tô acima da média?" são
  // perguntas de membro: sem elas aqui a resposta teria o número da semana e nada com que comparar.
  // É a mesma leitura da semana por dentro, então continua sendo uma chamada à API.
  const { weekStart, linhas } = await calcularMediasHistoricas();

  const busca = await encontrarMembro({ nome, linhas, discordId: contexto.discordId });
  const achados = busca.achados;

  if (!achados.length) return membroNaoEncontrado({ weekStart, busca });

  // Posição só faz sentido entre quem tem número; quem não pôde ser medido fica sem
  const ranking = medidas(linhas).sort((a, b) => b.contribuicao - a.contribuicao);
  const { media } = estatisticasDasMedias(linhas.filter(l => !l.motivoMedia));
  const posicaoDe = (linha) => {
    const i = ranking.findIndex(r => r.brawlhallaId === linha.brawlhallaId);
    return i === -1 ? null : i + 1;
  };

  const detalhes = achados.slice(0, MAX_LINHAS_EMBED).map(l => ({
    nome: l.nome,
    contribuicao_na_semana: l.motivo ? null : l.contribuicao,
    posicao_no_ranking: posicaoDe(l),
    media_por_semana: l.media,
    semanas_contadas: l.semanas == null ? null : Math.round(l.semanas),
    guild_points_totais: l.pontosTotais,
    motivo_sem_medicao: l.motivo,
  }));

  return {
    dados: {
      semana: dataBR(weekStart),
      procurado: busca.sobre === 'autor' ? 'quem perguntou' : busca.pedido,
      // A IA escreve "você" em vez do apelido quando a pergunta foi em primeira pessoa
      sobre_quem_perguntou: busca.sobre === 'autor',
      encontrado: true,
      unidade: UNIDADE,
      total_de_membros_medidos: ranking.length,
      media_da_guilda_por_semana: media,
      observacao: 'contribuicao_na_semana é o ganho desta semana; media_por_semana é a média do '
        + 'membro ao longo de todo o tempo de guilda, comparável com media_da_guilda_por_semana.',
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
      value: listaEmEmbed(detalhes.map(d => {
        const semana = d.motivo_sem_medicao
          ? `sem medição (${d.motivo_sem_medicao})`
          : `${numeroBR(d.contribuicao_na_semana)} (${d.posicao_no_ranking}º)`;

        const media = d.media_por_semana == null ? '' : ` • média ${numeroBR(d.media_por_semana)}/sem`;

        return `**${d.nome}** — ${semana}${media}`;
      })),
    }],
    rodape: `Semana de ${dataBR(weekStart)}`,
  };
}

/**
 * Jogos são da conta **principal** (`alt_ids`), contribuição é da conta que está na guilda — a
 * mesma divisão do `.scan` e do dossiê de blindagem. Juntar as duas medidas numa resposta só é o
 * ponto da ferramenta: quem joga muito e contribui pouco está jogando fora de missão.
 */
async function jogosDeMembro({ nome }, contexto = {}) {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();

  const busca = await encontrarMembro({ nome, linhas, discordId: contexto.discordId });
  const achados = busca.achados;

  if (!achados.length) return membroNaoEncontrado({ weekStart, busca });

  // Cada membro custa uma chamada à API de stats, então busca ampla pede nome melhor em vez de
  // consultar todo mundo que casou. O caminho do "eu" nunca cai aqui: resolve para uma conta só.
  if (achados.length > 1) {
    return {
      dados: {
        semana: dataBR(weekStart),
        procurado: busca.pedido,
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
      encontrado: true,
      sobre_quem_perguntou: busca.sobre === 'autor',
      // Aqui convivem duas unidades: partidas e guild points. Dizer qual é qual evita a frase
      // trocar "jogou 40 partidas" por "ganhou 40" e vice-versa.
      unidade_dos_jogos: 'partidas jogadas',
      unidade_da_contribuicao: UNIDADE,
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
      unidade: UNIDADE,
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
  media_de_contribuicao: mediaDeContribuicao,
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
  'Pergunta em primeira pessoa ("eu", "meu", "minha") é sobre quem perguntou: use as mesmas duas ' +
  'ferramentas e deixe o argumento nome vazio, mesmo que ela fale em média — ' +
  'contribuicao_de_membro já traz a média do membro e a da guilda junto. ' +
  'inativos_da_semana é só para contagem da guilda inteira, sem nome de ninguém. ' +
  'Na dúvida entre ranking e MVP, use ranking_contribuicao. ' +
  // "média" sem qualificação é a histórica: foi a decisão do usuário ao refazer a ferramenta, e é
  // o que o `.scan` mostra há mais tempo. O que a semana corrente tem de resumo vai no ranking.
  'media_de_contribuicao é a média por semana ao longo de todo o tempo de guilda, e é ela que ' +
  'responde qualquer pergunta sobre média sem dizer de qual período; ranking_contribuicao é a ' +
  'semana corrente, inclusive para "a semana está fraca?". ' +
  'Se nenhuma função responder a pergunta, use nao_sei_responder em vez de escolher a mais parecida.';

export const INSTRUCAO_RESPOSTA =
  'Você responde à staff de uma guilda de Brawlhalla, em português do Brasil. ' +
  'Use SOMENTE os números que vierem no resultado da função. Nunca some, calcule, estime ou ' +
  'complete com conhecimento próprio — se um dado não está no resultado, diga que não tem essa ' +
  'informação. ' +
  // A unidade tem que ser dita aqui: a instrução de escolha explica o que é contribuição, mas quem
  // escreve a frase é a segunda chamada, que não vê aquela instrução. Sem isto o modelo preenche a
  // lacuna sozinho e chamou os guild points de "XP" — que no jogo é outra medida, ganha em qualquer
  // partida, e é justamente a que não conta como contribuição (relatado pela staff em 12/08/2026).
  'Contribuição é medida em guild points, ganhos nas missões semanais da guilda. Chame esses ' +
  'números de "contribuição" ou de "guild points", NUNCA de XP: XP é outra coisa no Brawlhalla e ' +
  'não conta como contribuição. ' +
  // Os dois totais existem e medem coisas diferentes; sem esta regra o modelo pega a soma dos
  // membros, que é sempre a maior, e a apresenta como o total da guilda (relatado em 12/08/2026).
  'Se o resultado trouxer ganho_da_guilda_nesta_semana, é ESSE o total da semana da guilda, e é ele ' +
  'que a staff vê no jogo. Nunca apresente a soma do que os membros ganharam como total da guilda. ' +
  'Responda em no máximo 3 frases curtas, direto ao ponto, sem saudação e sem repetir ' +
  'a pergunta. Se o resultado trouxer sobre_quem_perguntou verdadeiro, fale em segunda pessoa ' +
  '("você contribuiu...") em vez de repetir o apelido. ' +
  'A lista completa já aparece abaixo da sua resposta, então não repita a lista ' +
  'inteira: cite no máximo dois ou três nomes. Se o resultado indicar que a medição é parcial, ' +
  'diga isso. Se uma busca por nome tiver encontrado mais gente do que foi mostrado, diga quantos ' +
  'foram encontrados e peça um nome mais específico.';
