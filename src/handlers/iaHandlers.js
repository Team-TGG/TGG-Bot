// Catálogo de ferramentas do `.ia` (usado por handleIa, em admin.js)
import { calcularContribuicaoSemanal, MOTIVOS } from '../services/contribuicaoSemanal.js';
import { calcularMediasHistoricas, estatisticasDasMedias, GUILD_POINTS_DESDE } from '../services/mediaHistorica.js';
import { selecionarMvpsDasLinhas } from '../services/weeklyMvpService.js';
import { calcularInativosDaSemana, CONTRIBUICAO_MINIMA, LIMIAR_INATIVACAO } from '../services/weeklyInactiveService.js';
import { calcularDueloDaSemana, calcularGanhoDaGuildaNaSemana, SEM_DUELO } from '../services/dueloSemanal.js';
import { getMissionWeekStart, getMissionWeekStartDateTime, getWeeklyInitial, getMovimentacaoDesde, getCadastroPorBrawlhallaIds, getUserByDiscordId, getMissionsByWeekStart, loadAliases, resolveBrawlhallaId, formatDateTime } from '../db.js';
import { missoesDaSemana as missoesDoCiclo, semanaVigente, semanaSeguinte } from '../services/weeklyMissionsService.js';
import { fetchPlayerStats, fetchPlayerStatsNoResolve, fetchPlayersByName, fetchClanStats, fetchGuildStats, fetchGuildMembers } from '../brawlhalla.js';
import { createPlayerLookup } from '../services/playerLookup.js';
import { escapeMarkdown } from 'discord.js';
import { calculateGames } from './publicHandlers.js';
import { weeklyMvp as mvpConfig, brawlhalla as brawlhallaConfig } from '../../config/index.js';

/**
 * O que o `.ia` sabe responder.
 *
 * Cada ferramenta é um par: a **declaração** que vai para a IA (`FERRAMENTAS`, no formato de
 * function calling) e o **executor** que roda no bot (`EXECUTORES`). A IA lê só a declaração e
 * escolhe uma; quem produz número é o executor, chamando as mesmas funções que o cron de quarta
 * usa. Ferramenta nova exige os dois — declaração sem executor vira "não sei responder".
 *
 * `conversa_livre` responde assuntos gerais sem chamar banco ou API do jogo. Perguntas sobre
 * dados atuais usam uma consulta específica; falhas de disponibilidade são apresentadas sem
 * inventar números. A persona é compartilhada, mas conversa e relatórios têm instruções distintas.
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
async function encontrarMembro({ nome, linhas, discordId, membroDiscordId }) {
  const pedido = String(nome ?? '').trim();
  const souEu = !pedido || PRIMEIRA_PESSOA.has(pedido.toLowerCase());

  if (!souEu && !membroDiscordId) {
    const busca = pedido.toLowerCase();
    return { achados: linhas.filter(l => l.nome.toLowerCase().includes(busca)), sobre: 'nome', pedido };
  }

  const alvoDiscordId = membroDiscordId || discordId;
  const sobre = String(alvoDiscordId) === String(discordId) ? 'autor' : 'mencao';
  if (!alvoDiscordId) return { achados: [], sobre: 'autor', pedido, semContexto: true };

  const user = await getUserByDiscordId(String(alvoDiscordId)).catch(() => null);

  if (!user?.brawlhalla_id) return { achados: [], sobre, pedido, semCadastro: true };

  return {
    achados: linhas.filter(l => l.brawlhallaId === String(user.brawlhalla_id)),
    sobre,
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
      'leaderboard da semana, e para saber se a semana está fraca ou forte. ' +
      'Não informa quantos membros existem na guilda: para tamanho da guilda use informacoes_da_guilda.',
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
      'coletivas sobre inativos, abaixo do mínimo ou risco de marcação. Nunca use para uma pessoa ' +
      'nomeada ou para "eu": nesses casos use contribuicao_de_membro.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'media_de_contribuicao',
    description:
      'Média de contribuição por semana de cada membro ao longo de todo o tempo de guilda (guild ' +
      'points totais divididos pelas semanas), com o ranking de quem tem a maior e a menor média. ' +
      'Use para perguntas sobre média de contribuição, quem rende mais ou menos por semana no ' +
      'geral, quem é consistente e quem contribui pouco de forma constante. Não é sobre a semana ' +
      'corrente: para isso use ranking_contribuicao. Perguntas coletivas sobre quem está acima ' +
      'ou abaixo da média, sem nome de pessoa ou primeira pessoa, usam esta ferramenta e não ' +
      'ranking_contribuicao. Abaixo da média pede ordem=menor; acima pede ordem=maior.',
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
    name: 'perfil_de_jogador',
    description:
      'Busca o perfil real de um jogador do Brawlhalla por apelido, menção ou ID: nome, nível, ' +
      'partidas e vitórias totais, elo e pico 1v1, melhor dupla 2v2, guilda e lendas mais jogadas. ' +
      'Use para "quem é o Trinca Ferro?", "mostre o perfil do Fulano", "qual o elo dele?" ou ' +
      '"qual lenda o Fulano mais joga?". Não é uma biografia de pessoa nem lore de lenda do jogo. ' +
      'Para partidas jogadas na semana use jogos_de_membro; para Guild Points use contribuicao_de_membro.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: { type: 'STRING', description: 'Apelido do jogador, preservando espaços e grafia. Deixe vazio para "eu" ou uma menção ao Discord.' },
        brawlhalla_id: { type: 'STRING', description: 'ID numérico do Brawlhalla, somente quando informado na pergunta. Não use o ID de uma menção ao Discord.' },
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
    name: 'missoes_da_semana',
    description:
      'As 4 missões semanais da guilda: o que cada uma pede, o alvo de pontos, a dica de como ' +
      'fazer e quais já foram concluídas. Use para perguntas sobre missões, quais faltam, o que a ' +
      'guilda ainda precisa fazer, como fazer uma missão, e também sobre as missões da próxima ' +
      'semana ou das que vêm por aí.',
    parameters: {
      type: 'OBJECT',
      properties: {
        quando: {
          type: 'STRING',
          enum: ['atual', 'proxima'],
          description: 'atual = as missões desta semana, com o que já foi concluído; proxima = as '
            + 'da semana que vem. Padrão: atual.',
        },
      },
    },
  },
  {
    name: 'conversa_livre',
    description:
      'Conversa geral com Lady Vera: cumprimentos, alô, piadas, opinião, explicações, dicas de ' +
      'Brawlhalla e assuntos sem consulta específica. Também serve quando o catálogo não possui ' +
      'a consulta solicitada: converse sem inventar dados atuais da TGG. Não use quando houver ' +
      'uma função específica para buscar os números pedidos. Elo e ranked de um jogador usam ' +
      'perfil_de_jogador. Ranking de elo da guilda inteira, saldo, TGG Coins e loja não possuem ' +
      'consultas neste catálogo: use conversa_livre nesses temas.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'informacoes_da_guilda',
    description: 'Dados básicos atuais da Team TGG: nome, quantidade total de membros, XP acumulado ' +
      'e pontuação semanal quando disponível. Use para quantos membros a guilda tem, nome ou tamanho ' +
      'da guilda; não para ranking de contribuição, MVP, inatividade ou partidas de uma pessoa.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'contribuicao_de_membro',
    description:
      'Contribuição da semana, posição no ranking e média de contribuição por semana de um membro ' +
      'específico, buscado pelo apelido no jogo. Use quando a pergunta cita o nome de uma pessoa, ' +
      'inclusive se essa pessoa corre risco de ser inativada ou está abaixo do mínimo, ' +
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

  const busca = await encontrarMembro({ nome, linhas, discordId: contexto.discordId, membroDiscordId: contexto.membroDiscordId });
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

const buscarJogador = createPlayerLookup({
  getMembers: async () => (await fetchClanStats()).clan,
  searchPlayers: fetchPlayersByName,
  getUser: getUserByDiscordId,
  // O perfil é da conta encontrada/informada, sem trocar silenciosamente por um alt vinculado.
  getStats: fetchPlayerStatsNoResolve,
});

function numeroDoPerfil(value) {
  if (value == null || value === '' || !['number', 'string'].includes(typeof value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function textoDoPerfil(value, max = 100) {
  return value == null ? null : String(value).replace(/[\r\n\t]/g, ' ').slice(0, max);
}

async function perfilDeJogador(args, contexto = {}) {
  const result = await buscarJogador(args, contexto);
  const rodape = 'Dados da API do Brawlhalla • perfil da conta consultada';
  if (result.status === 'ambiguous') {
    const names = result.candidates.map(player => textoDoPerfil(player.name));
    return {
      dados: { encontrado: false, ambiguo: true, total_encontrado: names.length, nomes: names.slice(0, MAX_LINHAS_EMBED),
        observacao: result.incomplete
          ? 'A busca pública atingiu o limite da primeira página; podem existir outras contas com esse nome. Peça o ID do Brawlhalla para confirmar a conta.'
          : 'Há mais de uma conta com esse nome. Peça o nome completo ou o ID do Brawlhalla; não atribua estatísticas de uma delas à pessoa procurada.' },
      titulo: '🔍 Qual jogador?',
      campos: [{ name: 'Especifique o nome ou informe o ID do Brawlhalla', value: listaEmEmbed(result.candidates.map(player => `**${escapeMarkdown(textoDoPerfil(player.name))}** — ID \`${player.id}\``)) }],
      rodape,
    };
  }
  if (result.status !== 'found') {
    const observacao = result.status === 'unregistered'
      ? (result.self ? 'Você não tem um ID do Brawlhalla cadastrado. Informe seu nome no jogo ou seu ID do Brawlhalla.' : 'O membro mencionado não tem um ID do Brawlhalla cadastrado. Informe o nome dele no jogo ou o ID do Brawlhalla.')
      : result.status === 'invalid-id' ? 'Informe um ID numérico válido do Brawlhalla, não o ID do Discord.'
        : result.status === 'invalid-name' ? 'Informe pelo menos 2 letras ou números do nome no jogo (máximo de 100 caracteres), ou o ID do Brawlhalla.'
          : 'Não encontrei essa conta na guilda ou na busca pública do ranking 1v1. Informe o nome completo no jogo ou o ID do Brawlhalla.';
    return { dados: { encontrado: false, observacao }, titulo: '🔍 Jogador não encontrado', campos: [{ name: 'Busca de jogador', value: observacao }], rodape };
  }
  const { stats } = result;
  const games = numeroDoPerfil(stats.games);
  const wins = numeroDoPerfil(stats.wins);
  const winRate = games > 0 && wins != null && wins <= games ? Number((wins / games * 100).toFixed(1)) : null;
  const ranked = stats.ranked;
  const rankSummary = data => data ? {
    elo: numeroDoPerfil(data.rating), pico_de_elo: numeroDoPerfil(data.peak_rating),
    rank: textoDoPerfil(data.tier, 40), partidas: numeroDoPerfil(data.games), vitorias: numeroDoPerfil(data.wins),
  } : null;
  const teams = Array.isArray(ranked?.['2v2']) ? ranked['2v2'] : null;
  const bestTeam = teams?.filter(team => numeroDoPerfil(team.rating) != null).sort((a, b) => Number(b.rating) - Number(a.rating))[0];
  const legends = (Array.isArray(stats.legends) ? stats.legends : []).filter(legend => numeroDoPerfil(legend.games) > 0)
    .sort((a, b) => Number(b.games) - Number(a.games)).slice(0, 3).map(legend => ({
      nome: textoDoPerfil(legend.legend_name_key || 'Lenda sem nome', 50),
      nivel: numeroDoPerfil(legend.level), partidas: numeroDoPerfil(legend.games), vitorias: numeroDoPerfil(legend.wins),
    }));
  const dados = {
    encontrado: true, sobre_quem_perguntou: result.self, nome: textoDoPerfil(stats.name),
    nivel: numeroDoPerfil(stats.level), jogos_totais: games, vitorias_totais: wins,
    derrotas_totais: games != null && wins != null && wins <= games ? games - wins : null,
    taxa_de_vitorias_percentual: winRate, guilda: textoDoPerfil(stats.clan?.clan_name),
    ranked_1v1: rankSummary(ranked),
    melhor_dupla_2v2: bestTeam ? { ...rankSummary(bestTeam), equipe: textoDoPerfil(bestTeam.teamname, 150) } : null,
    duplas_2v2_registradas: teams?.length ?? null,
    lendas_mais_jogadas: legends,
    observacao: 'Elo e partidas ranked são da temporada atual; totais e lendas são acumulados da conta. A dupla exibida é a de maior elo entre as equipes 2v2 registradas. Valores nulos estão indisponíveis e não significam zero. XP não é Guild Points.',
  };
  const valor = value => value == null ? 'Indisponível' : numeroBR(value);
  const rankField = data => data
    ? `Elo: **${valor(data.elo)}** • Pico: **${valor(data.pico_de_elo)}**\nRank: ${escapeMarkdown(data.rank || 'Indisponível')}\nPartidas: ${valor(data.partidas)} • Vitórias: ${valor(data.vitorias)}`
    : '_Indisponível._';
  return {
    dados,
    titulo: `🎮 Perfil de ${dados.nome}`,
    campos: [
      { name: 'Conta', value: `Nível: **${valor(dados.nivel)}**\nPartidas: **${valor(games)}** • Vitórias: **${valor(wins)}**\nTaxa de vitórias: ${winRate == null ? 'Indisponível' : `${numeroBR(winRate)}%`}`, inline: true },
      { name: 'Guilda', value: dados.guilda ? escapeMarkdown(dados.guilda) : '_Não informada pela API._', inline: true },
      { name: 'Ranked 1v1 • temporada atual', value: rankField(dados.ranked_1v1), inline: true },
      { name: 'Melhor dupla 2v2 • temporada atual', value: dados.melhor_dupla_2v2
        ? `${escapeMarkdown(dados.melhor_dupla_2v2.equipe || 'Equipe sem nome')}\n${rankField(dados.melhor_dupla_2v2)}`
        : teams?.length === 0 ? '_Sem duplas registradas nesta temporada._' : '_Indisponível._', inline: true },
      { name: 'Lendas mais jogadas • total da conta', value: legends.length ? legends.map(legend => `**${escapeMarkdown(legend.nome)}** — ${valor(legend.partidas)} partidas • nível ${valor(legend.nivel)}`).join('\n') : '_Sem dados de lendas jogadas._' },
    ],
    rodape,
  };
}

/**
 * Jogos são da conta **principal** (`alt_ids`), contribuição é da conta que está na guilda — a
 * mesma divisão do `.scan` e do dossiê de blindagem. Juntar as duas medidas numa resposta só é o
 * ponto da ferramenta: quem joga muito e contribui pouco está jogando fora de missão.
 */
async function jogosDeMembro({ nome }, contexto = {}) {
  const { weekStart, linhas } = await calcularContribuicaoSemanal().catch(async error => {
    if (!error.apiForaDoAr && !error.guildPointsUnavailable) throw error;
    // Jogos continuam disponíveis na v0. A lista parcial só identifica o membro, nunca mede GP.
    const guild = await fetchGuildMembers(undefined, { requireGuildPoints: false });
    return { weekStart: getMissionWeekStart(), linhas: guild.guild_members.map(member => ({
      brawlhallaId: String(member.brawlhalla_id), nome: member.name,
      contribuicao: null, motivo: MOTIVOS.PONTOS_INDISPONIVEIS,
    })) };
  });

  const busca = await encontrarMembro({ nome, linhas, discordId: contexto.discordId, membroDiscordId: contexto.membroDiscordId });
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
    rodape: `Semana de ${dataBR(weekStart)} • ${stats?.games == null ? 'total indisponível' : `${numeroBR(stats.games)} jogos no total`}`,
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
      observacao: 'O placar usa os Guild Points da semana devolvidos pela API, que reiniciam semanalmente.',
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
    rodape: 'Guild Points da semana • mesmo cálculo do .duel',
  };
}

/**
 * As 4 missões de uma semana, com dica e o que já foi concluído.
 *
 * Duas fontes, e qual delas respondeu vai dito no `dados`:
 *
 * - **cadastro** (`weekly_missions`): o que vale. É o que o `.missoes` mostra, e o único lugar onde
 *   existe `status` — marcado pela staff no `.missaoConcluida`, nunca deduzido pelo bot.
 * - **ciclo** ([weeklyMissionsService.js](../services/weeklyMissionsService.js)): previsão. A semana
 *   seguinte só é cadastrada na quinta 06:00, então para ela é a única resposta possível. Pode
 *   divergir do que for cadastrado, porque a staff corrige divergência com o jogo pelo site — daí
 *   a previsão sair rotulada em vez de se passar pelo cadastro.
 */
async function missoesDaSemana({ quando = 'atual' }) {
  const proxima = String(quando).toLowerCase().startsWith('prox');
  const weekStart = proxima ? semanaSeguinte() : semanaVigente();

  const cadastradas = await getMissionsByWeekStart(weekStart);
  const previsao = !cadastradas.length;
  const missoes = previsao ? missoesDoCiclo(weekStart) : cadastradas;

  const linhas = missoes.map((m, i) => ({
    posicao: i + 1,
    missao: m.mission,
    alvo_de_pontos: m.target,
    dica: m.tip,
    // null = semana que ainda não começou. "Não concluída" e "não dá para saber" são coisas
    // diferentes, e dizer que falta fazer uma missão da semana que vem não quer dizer nada.
    concluida: previsao ? null : m.status === 'done',
  }));

  const concluidas = linhas.filter(l => l.concluida).length;

  return {
    dados: {
      semana: dataBR(weekStart),
      qual_semana: proxima ? 'a próxima semana' : 'a semana corrente',
      periodo: 'de quinta 06:00 até a quarta seguinte 06:00',
      fonte: previsao
        ? 'previsão pelo ciclo de rotação — esta semana AINDA NÃO foi cadastrada'
        : 'missões cadastradas',
      // Dito como afirmação de propósito. Na primeira versão a observação dizia "ainda não foi
      // cadastrada", e o modelo leu isso como falta de dado e respondeu "não tenho essa informação"
      // — com as quatro missões na mão (12/08/2026). Ressalva não pode soar como ausência.
      observacao: previsao
        ? 'Estas SÃO as missões dessa semana, calculadas pelo ciclo fixo de rotação que o próprio '
          + 'bot usa para cadastrá-las. Responda com a lista normalmente, chamando-as de '
          + '"previstas" e nunca de "cadastradas", e avise que o cadastro oficial sai na quinta '
          + '06:00, quando a staff ainda pode ajustar divergência com o jogo.'
        : 'concluida é o que a staff marcou no .missaoConcluida; missão feita e ainda não marcada '
          + 'aparece como não concluída.',
      total: linhas.length,
      // Em previsão os dois campos ficam de fora: a semana não começou, então "0 concluídas" seria
      // uma informação inventada sobre uma semana que ninguém jogou.
      ...(previsao
        ? { a_semana_ainda_nao_comecou: true }
        : { concluidas, faltam: linhas.length - concluidas }),
      missoes: linhas,
    },
    titulo: previsao ? `📋 Missões previstas para ${dataBR(weekStart)}` : '📋 Missões da semana',
    campos: linhas.map(l => ({
      name: `${l.concluida ? '✅' : previsao ? '🔜' : '📌'} ${l.posicao}. ${l.missao}`.slice(0, 256),
      value: `🎯 Alvo: **${numeroBR(l.alvo_de_pontos)}**\n💡 ${l.dica}`.slice(0, MAX_CARACTERES_CAMPO),
    })),
    rodape: previsao
      ? `Semana de ${dataBR(weekStart)} • previsão pelo ciclo, o cadastro sai na quinta 06:00`
      : `Semana de ${dataBR(weekStart)} • ${concluidas} de ${linhas.length} concluídas`,
  };
}

async function informacoesDaGuilda() {
  const guild = await fetchGuildStats(brawlhallaConfig.clanId, { requireGuildPoints: false });
  return {
    dados: { nome: guild.name, membros: guild.member_count, xp_acumulado: guild.xp_total,
      guild_points_semanais: guild.guild_points, fonte: guild.apiSource,
      observacao: guild.guild_points == null ? 'Guild Points indisponíveis; XP não substitui contribuição.' : 'Guild Points representam a semana atual.' },
    titulo: `🏰 ${guild.name}`,
    campos: [{ name: 'Membros', value: guild.member_count == null ? 'Indisponível' : String(guild.member_count), inline: true },
      { name: 'XP acumulado', value: guild.xp_total == null ? 'Indisponível' : numeroBR(guild.xp_total), inline: true },
      { name: 'Guild Points da semana', value: guild.guild_points == null ? 'Indisponíveis no momento' : numeroBR(guild.guild_points) }],
    rodape: guild.apiSource === 'v0' ? 'Dados básicos da API antiga • GP indisponível' : 'Dados da guilda',
  };
}

function conversaLivre() {
  return { dados: { modo: 'conversa_livre' }, titulo: 'Lady Vera', campos: [], rodape: 'Conversa com Lady Vera' };
}

export const EXECUTORES = {
  conversa_livre: conversaLivre,
  perfil_de_jogador: perfilDeJogador,
  informacoes_da_guilda: informacoesDaGuilda,
  ranking_contribuicao: rankingContribuicao,
  media_de_contribuicao: mediaDeContribuicao,
  mvps_da_semana: mvpsDaSemana,
  inativos_da_semana: inativosDaSemana,
  contribuicao_de_membro: contribuicaoDeMembro,
  jogos_de_membro: jogosDeMembro,
  movimentacao_da_guilda: movimentacaoDaGuilda,
  duelo_da_semana: dueloDaSemana,
  missoes_da_semana: missoesDaSemana,
};

/** Falhas de uma fonte de dados não desligam a conversa nem viram estatísticas fictícias. */
export async function executarConsultaIa(nome, args, contexto) {
  try { return await EXECUTORES[nome](args, contexto); }
  catch (error) {
    if (!error.apiForaDoAr && !error.guildPointsUnavailable) throw error;
    return {
      dados: { consulta: nome, dados_indisponiveis: true,
        observacao: 'A fonte de dados do Brawlhalla está indisponível agora. Não há números atuais ' +
          'para esta consulta. Não inferir zeros, ranking, MVP ou punição. A conversa geral continua disponível.' },
      titulo: nome === 'perfil_de_jogador' ? 'Perfil do Brawlhalla indisponível' : 'Registros da guilda indisponíveis',
      campos: [{ name: 'Consulta', value: 'Não foi possível conferir esses dados agora. Podemos continuar conversando ou consultar outros registros disponíveis.' }],
      rodape: 'Dados indisponíveis • nenhum valor estimado',
    };
  }
}

// ---- Instruções ----

export const INSTRUCAO_ESCOLHA =
  'Você roteia perguntas dos membros de um servidor de Brawlhalla para as funções de um bot. ' +
  'Escolha exatamente uma função e preencha os argumentos a partir da pergunta. ' +
  'Contexto: "contribuição" são guild points ganhos na semana; a semana vai de quinta 06:00 a ' +
  'quarta 06:00; a contribuição mínima exigida de cada membro é ' + CONTRIBUICAO_MINIMA + ' por semana. ' +
  // A regra do nome vem primeiro e diz "mesmo que", porque "fulano corre risco de ser inativado?"
  // casa com as duas: sem a precedência explícita o modelo responde a contagem da guilda inteira
  // para uma pergunta sobre uma pessoa (medido em 11/08/2026).
  'Perguntas "quem é o Trinca Ferro?", perfil, estatísticas gerais, nível, elo, ranked ou lendas mais jogadas ' +
  'de uma pessoa usam perfil_de_jogador com o nome citado. Para um ID explícito do Brawlhalla, use brawlhalla_id. ' +
  'Menções do Discord deixam nome e brawlhalla_id vazios: o bot resolve a conta mencionada. ' +
  'Perguntas sobre personagens/lendas do jogo ou sobre a própria Lady Vera usam conversa_livre, não perfil_de_jogador. ' +
  'Consulta de contribuição, média, inativação ou risco que cita o nome de uma pessoa usa contribuicao_de_membro. ' +
  'Consulta de partidas jogadas, sobretudo na semana ou em comparação com contribuição, usa jogos_de_membro. ' +
  'Pergunta em primeira pessoa ("eu", "meu", "minha") é sobre quem perguntou: use as mesmas duas ' +
  'ferramentas, ou perfil_de_jogador para perfil, nível, elo ou lendas, e deixe nome e brawlhalla_id vazios, mesmo que ela fale em média — ' +
  'contribuicao_de_membro já traz a média do membro e a da guilda junto. ' +
  'inativos_da_semana é só para contagem da guilda inteira, sem nome de ninguém. ' +
  'Na dúvida entre ranking e MVP, use ranking_contribuicao. ' +
  // "média" sem qualificação é a histórica: foi a decisão do usuário ao refazer a ferramenta, e é
  // o que o `.scan` mostra há mais tempo. O que a semana corrente tem de resumo vai no ranking.
  'media_de_contribuicao é a média por semana ao longo de todo o tempo de guilda, e é ela que ' +
  'responde qualquer pergunta sobre média sem dizer de qual período; ranking_contribuicao é a ' +
  'semana corrente, inclusive para "a semana está fraca?". ' +
  // Missão é da guilda e contribuição é da pessoa, mas as duas vivem na mesma semana e a pergunta
  // costuma misturar ("o que falta essa semana?"). O desempate é o objeto: tarefa x número.
  'Pergunta sobre as missões em si — quais são, o que cada uma pede, quais faltam, como fazer — é ' +
  'missoes_da_semana; se ela fala da semana que vem ou das próximas missões, use quando=proxima. ' +
  'Quanto alguém ou a guilda pontuou continua sendo ranking_contribuicao. ' +
  'Cumprimentos, bate-papo, explicações e assuntos sem consulta específica usam conversa_livre. ' +
  'Nunca tente responder um alô consultando contribuição. Se nenhuma função buscar os dados ' +
  'pedidos, use conversa_livre sem inventar esses dados. Quantidade total de membros, nome e XP ' +
  'da guilda usam informacoes_da_guilda, não o ranking de contribuição. Elo e ranked individuais usam perfil_de_jogador. ' +
  'Ranking de elo da guilda inteira, TGG Coins, saldo ou loja usam conversa_livre: contribuição é somente Guild Points, ' +
  'nunca moedas da loja ou elo. Não invente nomes ou IDs que não apareceram na pergunta.';

export const INSTRUCAO_CONVERSA =
  'Você interpreta Lady Vera, a Luminária de Brawlhalla: sábia, altiva, serena e devota à luz. ' +
  'Sua lore envolve sigilos de luz e um leão companheiro; suas armas são Chakram e Foice. ' +
  'Converse livremente em português do Brasil, com autoridade elegante, ironia leve e referências ' +
  'ocasionais a luz ou sigilos. Responda de verdade ao assunto: cumprimentos, humor, dúvidas, dicas ' +
  'de Brawlhalla e outros temas. Não fique limitada a relatórios da guilda nem diga que só pode ' +
  'falar de contribuição. Seja natural e clara, em até dois parágrafos curtos, sem insistir em ' +
  'limitações ou listar assuntos que pode responder. Em cumprimentos, use uma ou duas frases ' +
  'cordiais e puxe conversa. Só explique ausência de dados se a pergunta pedir esses dados. Evite ' +
  'listar funcionalidades. A guilda do bot é Team TGG; a contribuição mínima semanal configurada ' +
  `é ${CONTRIBUICAO_MINIMA} guild points, e a semana de missões vai de quinta 06:00 a quarta 06:00. ` +
  'Essas são regras estáticas, não o placar atual. Você não recebeu números atuais de membros, ' +
  'MVPs, elo, saldo ou punições: não invente nenhum desses dados. Reconheça quando não souber ' +
  'algo. Sua persona é ficcional e não lhe dá acesso a fatos que não foram consultados.';

export const INSTRUCAO_RESPOSTA =
  'Você responde aos membros de um servidor de Brawlhalla, em português do Brasil. ' +
  'Interprete Lady Vera, a Luminária de Brawlhalla: sábia, altiva, serena e devota à luz. ' +
  'Fale com autoridade elegante e uma leve ironia de mentora exigente; inclua uma única imagem ' +
  'curta sobre luz ou sigilos por resposta. Seja legível e útil, sem arcaísmos difíceis, ' +
  'sem insultar membros e sem alegar poderes reais ou conhecimento além dos registros. ' +
  'A personalidade aparece no tom, nunca alterando nomes, números, unidades ou ressalvas. ' +
  'Use SOMENTE os números que vierem no resultado da função. Nunca some, calcule, estime ou ' +
  'escreva valores por extenso. Use algarismos e copie os valores exatos dos registros. Nunca ' +
  'complete com conhecimento próprio — se um dado não está no resultado, diga que não tem essa ' +
  'informação. ' +
  'Se não houver critério de comparação nos registros, não classifique a semana como fraca ou ' +
  'forte: apresente os valores disponíveis e diga que eles não bastam para essa conclusão. ' +
  // Sem esta ressalva a regra acima vira recusa: com as quatro missões da semana que vem na mão,
  // o modelo leu "previsão, ainda não cadastrada" como ausência de dado e respondeu "não tenho
  // essa informação" (12/08/2026). Previsão e medição parcial são respostas, com ressalva junto.
  'Isso vale só para o que realmente não veio: se o resultado traz a lista ou o número, responda ' +
  'com ele mesmo que venha marcado como previsão, prévia ou medição parcial, dizendo a ressalva ' +
  'junto. Nunca diga que não tem a informação tendo recebido os dados. ' +
  'Quando a fonte for previsão pelo ciclo, diga explicitamente "missões previstas" e que o ' +
  'cadastro oficial ainda não ocorreu. Dê essa ressalva antes de qualquer floreio de personagem. ' +
  // A unidade tem que ser dita aqui: a instrução de escolha explica o que é contribuição, mas quem
  // escreve a frase é a segunda chamada, que não vê aquela instrução. Sem isto o modelo preenche a
  // lacuna sozinho e chamou os guild points de "XP" — que no jogo é outra medida, ganha em qualquer
  // partida, e é justamente a que não conta como contribuição (relatado pela staff em 12/08/2026).
  'Contribuição é medida em guild points, ganhos nas missões semanais da guilda. Chame esses ' +
  'números de "contribuição" ou de "guild points", NUNCA de XP: XP é outra coisa no Brawlhalla e ' +
  'não conta como contribuição. ' +
  'Campos explicitamente chamados XP ou partidas conservam essas unidades; a regra de guild ' +
  'points se aplica apenas a contribuição. Nunca converta XP em Guild Points. ' +
  // Os dois totais existem e medem coisas diferentes; sem esta regra o modelo pega a soma dos
  // membros, que é sempre a maior, e a apresenta como o total da guilda (relatado em 12/08/2026).
  'Se o resultado trouxer ganho_da_guilda_nesta_semana, é ESSE o total da semana da guilda, e é ele ' +
  'que a staff vê no jogo. Nunca apresente a soma do que os membros ganharam como total da guilda. ' +
  'Responda em no máximo 3 frases curtas, direto ao ponto, sem saudação, sem se apresentar e sem repetir ' +
  'a pergunta. Se o resultado trouxer sobre_quem_perguntou verdadeiro, fale em segunda pessoa ' +
  '("você contribuiu...") em vez de repetir o apelido. ' +
  'Sem sobre_quem_perguntou verdadeiro, nunca atribua números ao leitor: os primeiros nomes de ' +
  'uma lista não são necessariamente quem perguntou. ' +
  'A lista completa já aparece abaixo da sua resposta, então não repita a lista ' +
  'inteira: cite no máximo dois ou três nomes. Se o resultado indicar que a medição é parcial, ' +
  'diga isso. Se uma busca por nome tiver encontrado mais gente do que foi mostrado, diga quantos ' +
  'foram encontrados e peça um nome mais específico.';
