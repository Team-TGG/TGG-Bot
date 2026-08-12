#!/usr/bin/env node
// Perguntas de referência do `.ia`: cada pergunta com a ferramenta que deve responder.
// Rode da raiz do projeto:  node .claude/skills/checar/perguntas.mjs
//
// Separado do check.mjs de propósito: aquele é offline e roda em 2s, este gasta rede e cota da
// API. Misturar os dois faria a checagem de todo commit depender do free tier do Gemini.
//
// O que decide o roteamento é a `description` de cada ferramenta em src/handlers/iaHandlers.js -
// editar uma descrição para consertar uma pergunta pode roubar outra da ferramenta vizinha, e sem
// esta lista isso só aparece quando a staff reclama. Passa pelo `escolherFerramenta` de verdade,
// não por uma cópia da chamada: modelo, instrução e formato são os que o `.ia` usa.
import 'dotenv/config';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const importar = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const { FERRAMENTAS, INSTRUCAO_ESCOLHA, INSTRUCAO_RESPOSTA } = await importar('src/handlers/iaHandlers.js');
const { escolherFerramenta, redigirResposta, iaConfigurada } = await importar('src/services/iaProvider.js');
const { ia: config } = await importar('config/index.js');

// Ferramenta esperada e, quando o argumento faz parte da resposta certa, os campos que importam.
// Argumento não listado aqui é livre: pedir "top 5" com `ordem: 'maior'` junto continua certo.
const CASOS = [
  ['quantos estão abaixo do mínimo?', 'inativos_da_semana'],
  ['quantos vao ser marcados como inativos na quarta?', 'inativos_da_semana'],
  ['quem são os MVPs da semana?', 'mvps_da_semana'],
  ['quem contribuiu menos essa semana?', 'ranking_contribuicao', { ordem: 'menor' }],
  ['quem ta no topo do leaderboard?', 'ranking_contribuicao', { ordem: 'maior' }],
  // O `limite` é o caso que separa modelo bom de modelo ruim: errar ele acerta a ferramenta e
  // erra a resposta. Foi o que reprovou o Gemma 4 na comparação de 11/08/2026.
  ['me mostra o top 5 da semana', 'ranking_contribuicao', { limite: 5 }],
  ['quanto o Feijao contribuiu?', 'contribuicao_de_membro', { nome: 'Feijao' }],
  ['o Pizzolho corre risco de ser inativado?', 'contribuicao_de_membro', { nome: 'Pizzolho' }],
  // "Média" sem período é a histórica (total ÷ semanas de guilda); a semana corrente é o ranking.
  // As duas ferramentas falam de contribuição, então este par é o que denuncia uma roubando a
  // pergunta da outra depois de qualquer mexida nas descrições.
  ['quem tem a maior média de contribuição?', 'media_de_contribuicao', { ordem: 'maior' }],
  ['quem tem as piores médias da guilda?', 'media_de_contribuicao', { ordem: 'menor' }],
  ['quem está abaixo da média?', 'media_de_contribuicao', { ordem: 'menor' }],
  ['a semana tá fraca?', 'ranking_contribuicao'],
  ['quanto a guilda contribuiu essa semana?', 'ranking_contribuicao'],
  // Primeira pessoa: tem que chegar sem `nome` para o executor resolver pelo discord_id de quem
  // perguntou. `nome: null` afirma que o argumento veio vazio.
  ['quanto eu contribuí essa semana?', 'contribuicao_de_membro', { nome: null }],
  ['eu tô acima da média?', 'contribuicao_de_membro', { nome: null }],
  ['qual a minha média de contribuição?', 'contribuicao_de_membro', { nome: null }],
  ['quantos jogos eu fiz?', 'jogos_de_membro', { nome: null }],
  // Nome de pessoa + partidas vai para jogos_de_membro, não para contribuicao_de_membro: as duas
  // casam com "cita uma pessoa" e a instrução de escolha desempata.
  ['quantos jogos o Feijao fez essa semana?', 'jogos_de_membro', { nome: 'Feijao' }],
  ['o Pizzolho jogou muito e contribuiu pouco?', 'jogos_de_membro', { nome: 'Pizzolho' }],
  ['quem entrou na guilda essa semana?', 'movimentacao_da_guilda'],
  ['teve muita saída nos últimos 7 dias?', 'movimentacao_da_guilda', { dias: 7 }],
  ['quem foi promovido?', 'movimentacao_da_guilda'],
  ['contra quem a gente joga o duelo essa semana?', 'duelo_da_semana'],
  ['a gente tá ganhando o duelo?', 'duelo_da_semana'],
  // Fora do catálogo: sem `nao_sei_responder` o `mode: 'ANY'` obriga o modelo a escolher uma das
  // outras e a resposta sai confiante e errada. Ferramenta nova pode reabrir esse buraco.
  ['quantos membros a guilda tem?', 'nao_sei_responder'],
  ['qual o elo mais alto da guilda?', 'nao_sei_responder'],
  ['quem tem mais TGG Coins?', 'nao_sei_responder'],
  // Missão é tarefa da guilda; contribuição é número de gente. As duas vivem na mesma semana e a
  // pergunta mistura ("o que falta essa semana?"), então os dois lados ficam na lista.
  ['quais são as missões dessa semana?', 'missoes_da_semana'],
  ['quais missões ainda faltam?', 'missoes_da_semana'],
  ['como faço a missão de crew battle?', 'missoes_da_semana'],
  ['quais as missões da próxima semana?', 'missoes_da_semana', { quando: 'proxima' }],
  ['quais as próximas missões?', 'missoes_da_semana', { quando: 'proxima' }],
];

/**
 * A segunda chamada do `.ia`: a que escreve a frase. Cada caso é um resultado inventado, com a
 * forma que o executor devolve, e o que a frase precisa (ou não pode) dizer sobre ele — dá para
 * medir o texto sem tocar no banco nem na API do Brawlhalla.
 *
 * Tudo aqui nasceu de erro relatado pela staff. A frase é o comando inteiro: o embed sai com os
 * números do mesmo jeito, então resposta plausível e errada passa por certa.
 */
const RESPOSTAS = [
  {
    pergunta: 'a semana tá fraca?',
    // Forma de `ranking_contribuicao`
    resultado: {
      semana: '06/08/2026',
      unidade: 'guild points ganhos nas missões da guilda (não é XP)',
      ordem: 'menor',
      pontuaram_nesta_semana: 178,
      zeraram_nesta_semana: 18,
      media_desta_semana_entre_quem_pontuou: 2186,
      ganho_da_guilda_nesta_semana: 343497,
      soma_do_que_os_membros_ganharam: 432826,
      por_que_os_dois_totais_diferem: 'Membro pontua a cada partida que avança uma missão, mas a '
        + 'guilda só pontua quando um tier da missão fecha (mais as guild battles). A soma dos '
        + 'membros é normalmente maior e NÃO é o total da guilda. Ao falar do total da semana da '
        + 'guilda, use ganho_da_guilda_nesta_semana.',
      membros: [
        { nome: 'Fulano', contribuicao_na_semana: 120, posicao: 196 },
        { nome: 'Beltrano', contribuicao_na_semana: 340, posicao: 195 },
      ],
    },
    checagens: [
      {
        // O executor sabe a unidade e o modelo não: sem ela dita, ele preencheu a lacuna com "XP".
        // No jogo XP é outra medida, ganha em qualquer partida, inclusive contra bot, e é
        // justamente a que **não** conta como contribuição (12/08/2026).
        rotulo: 'a unidade sai certa (guild points, não XP)',
        erro: 'a resposta chamou os guild points de "XP" - XP é a medida que não conta como contribuição',
        ok: (texto) => !/\bxp\b/i.test(texto),
      },
      {
        // Os dois totais da semana medem coisas diferentes e o dos membros é sempre o maior. A
        // staff compara com o que vê no jogo, que é o da guilda (12/08/2026).
        rotulo: 'o total da semana é o da guilda, não a soma dos membros',
        erro: 'a resposta usou a soma dos membros (432.826) como total da semana, em vez do ganho da guilda (343.497)',
        ok: (texto) => !/432[.\s]?826/.test(texto) || /343[.\s]?497/.test(texto),
      },
    ],
  },
  {
    pergunta: 'quais as missões da próxima semana?',
    // Forma de `missoes_da_semana` com `quando: 'proxima'`, que nunca está cadastrada
    resultado: {
      semana: '13/08/2026',
      qual_semana: 'a próxima semana',
      periodo: 'de quinta 06:00 até a quarta seguinte 06:00',
      fonte: 'previsão pelo ciclo de rotação — esta semana AINDA NÃO foi cadastrada',
      observacao: 'Estas SÃO as missões dessa semana, calculadas pelo ciclo fixo de rotação que o '
        + 'próprio bot usa para cadastrá-las. Responda com a lista normalmente, chamando-as de '
        + '"previstas" e nunca de "cadastradas", e avise que o cadastro oficial sai na quinta '
        + '06:00, quando a staff ainda pode ajustar divergência com o jogo.',
      total: 4,
      a_semana_ainda_nao_comecou: true,
      missoes: [
        { posicao: 1, missao: 'Alcance a onda 26 no modo Horda', alvo_de_pontos: 16, dica: 'Criem um lobby com 4 pessoas.', concluida: null },
        { posicao: 2, missao: 'Vitórias no Brawl of the Week', alvo_de_pontos: 750, dica: 'É necessário GANHAR.', concluida: null },
        { posicao: 3, missao: 'Ranked 2v2 com membro da guilda', alvo_de_pontos: 3750, dica: 'Não precisa vencer.', concluida: null },
        { posicao: 4, missao: 'Jogos de Brawlball', alvo_de_pontos: 1000, dica: 'Lobby cheio, 5 x 0.', concluida: null },
      ],
    },
    checagens: [
      {
        // Previsão dita como ressalva vira "não tenho essa informação" com as quatro missões na
        // mão (12/08/2026). O que separa uma ressalva de uma ausência é o texto do `dados`.
        rotulo: 'a previsão do ciclo é respondida, não recusada',
        erro: 'a resposta não citou nenhuma missão prevista - a ressalva do ciclo virou "não sei"',
        ok: (texto) => /horda|brawl|2v2|brawlball/i.test(texto),
      },
      {
        // O outro lado do mesmo campo: previsão apresentada como cadastro faz a staff planejar a
        // semana em cima de uma lista que a quinta-feira ainda pode mudar (12/08/2026).
        rotulo: 'a previsão não é apresentada como cadastro',
        erro: 'a resposta chamou a previsão do ciclo de "missões cadastradas" - elas só são cadastradas na quinta 06:00',
        ok: (texto) => !/missões cadastradas/i.test(texto) || /não (foram|estão|são)/i.test(texto),
      },
    ],
  },
];

// O free tier limita por minuto, não só por dia: 16 perguntas seguidas levam 429 no fim da lista
// (medido em 11/08/2026 — um minuto depois a mesma chave responde 200). O intervalo mantém o ritmo
// abaixo do teto e o retry cobre o caso de a lista crescer ou de o bot estar sendo usado junto.
const INTERVALO_MS = 5_000;
const ESPERA_APOS_429_MS = 65_000;
const ESPERA_APOS_FALHA_MS = 3_000;

const linha = '─'.repeat(72);
const falhas = [];
let gastas = 0;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Uma tentativa a mais quando a falha é de ritmo ou de rede. Cota diária estourada falha nas duas,
 * e roteamento errado não é falha — chega aqui como resposta normal.
 *
 * Timeout entra no retry porque o teto de 20s do `iaProvider` estoura sozinho de vez em quando, e
 * sem isso a lista acusa erro de roteamento onde só houve rede ruim.
 */
async function comRetry(fn) {
  gastas++;
  try {
    return await fn();
  } catch (e) {
    const porRitmo = e.message.includes('429');
    const transitoria = /timeout|abort|fetch failed|ECONNRESET/i.test(e.message);

    if (!porRitmo && !transitoria) throw e;

    const espera = porRitmo ? ESPERA_APOS_429_MS : ESPERA_APOS_FALHA_MS;
    console.log(`  ...  ${porRitmo ? '429 (limite por minuto)' : 'falha transitória'}, esperando ${espera / 1000}s`);
    await dormir(espera);
    gastas++;
    return fn();
  }
}

if (!iaConfigurada()) {
  console.error('\n  Falta a GEMINI_API_KEY no .env. Sem ela não dá para medir o roteamento.\n');
  process.exit(2);
}

/**
 * Só os campos que o caso declara. String compara sem caixa: o modelo pode devolver o nome cru.
 *
 * `null` afirma **ausência**, que é o que define o "eu": a pergunta em primeira pessoa tem que
 * chegar ao executor sem `nome`, senão ele procura "eu" no apelido e casa com meia guilda.
 */
function argumentosBatem(esperados, recebidos = {}) {
  return Object.entries(esperados).every(([chave, valor]) => {
    const veio = recebidos[chave];
    if (valor === null) return veio === undefined || veio === null || String(veio).trim() === '';
    if (typeof valor === 'string') return String(veio ?? '').toLowerCase() === valor.toLowerCase();
    return veio === valor;
  });
}

console.log(`\n${linha}\n  PERGUNTAS DE REFERÊNCIA DO .ia  —  ${config.modelo}\n${linha}`);

for (const [indice, [pergunta, ferramenta, argsEsperados]] of CASOS.entries()) {
  let escolha = null;
  let erro = null;

  if (indice) await dormir(INTERVALO_MS);

  try {
    escolha = await comRetry(() => escolherFerramenta({ pergunta, ferramentas: FERRAMENTAS, instrucao: INSTRUCAO_ESCOLHA }));
  } catch (e) {
    erro = e.message;
  }

  const recebida = escolha?.nome ?? null;
  const argsOk = !argsEsperados || (recebida === ferramenta && argumentosBatem(argsEsperados, escolha?.args));
  const passou = !erro && recebida === ferramenta && argsOk;

  const mostrado = erro
    ? erro.slice(0, 60)
    : `${recebida ?? 'nenhuma'}${escolha && Object.keys(escolha.args ?? {}).length ? JSON.stringify(escolha.args) : ''}`;

  console.log(`  ${passou ? 'ok   ' : 'ERRO '}${JSON.stringify(pergunta)} -> ${mostrado}`);

  if (!passou) {
    falhas.push(`${JSON.stringify(pergunta)}: esperado ${ferramenta}${argsEsperados ? ' ' + JSON.stringify(argsEsperados) : ''}, veio ${mostrado}`);
  }
}

// A frase escrita. Ela falhava calada por um mês: o 400 de thought_signature cai no `.catch` de
// handleIa, que devolve '' e deixa o embed sair só com os números - o comando parece funcionar e a
// frase, que é o comando inteiro, nunca aparece. Só o texto vazio denuncia.
console.log(`${linha}`);

for (const { pergunta, resultado, checagens } of RESPOSTAS) {
  try {
    await dormir(INTERVALO_MS);

    const escolha = await comRetry(() => escolherFerramenta({
      pergunta,
      ferramentas: FERRAMENTAS,
      instrucao: INSTRUCAO_ESCOLHA,
    }));

    await dormir(INTERVALO_MS);

    const texto = await comRetry(() => redigirResposta({
      pergunta,
      escolha,
      resultado,
      instrucao: INSTRUCAO_RESPOSTA,
    }));

    if (!texto) {
      console.log(`  ERRO  ${JSON.stringify(pergunta)}: texto vazio`);
      falhas.push(`redigirResposta devolveu texto vazio para ${JSON.stringify(pergunta)} - o embed sairia só com os números`);
      continue;
    }

    console.log(`  ok    ${JSON.stringify(pergunta)}: "${texto.slice(0, 80)}${texto.length > 80 ? '…' : ''}"`);

    for (const { rotulo, erro, ok } of checagens) {
      if (ok(texto)) {
        console.log(`  ok      ${rotulo}`);
      } else {
        console.log(`  ERRO    ${rotulo}`);
        falhas.push(erro);
      }
    }
  } catch (e) {
    console.log(`  ERRO  redigirResposta: ${e.message.slice(0, 120)}`);
    falhas.push(`redigirResposta falhou em ${JSON.stringify(pergunta)}: ${e.message.slice(0, 120)}`);
  }
}

// O par declaração + executor é conferido pelo executores.mjs, que roda sem gastar cota.

console.log(linha);
console.log(`  ${CASOS.length - falhas.filter(f => f.startsWith('"')).length}/${CASOS.length} perguntas, ${gastas} requisições gastas`);
for (const f of falhas) console.log(`  ERRO  ${f}`);
console.log(`${linha}\n`);

// O grafo de imports deixa handle aberto (rate limiter do brawlhalla.js), então o processo não
// fecha sozinho.
process.exit(falhas.length ? 1 : 0);
