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
  ['quais são as missões dessa semana?', 'nao_sei_responder'],
];

// Resultado inventado, com a forma que `ranking_contribuicao` devolve. Serve para checar a segunda
// chamada sem tocar no banco nem na API do Brawlhalla.
const PERGUNTA_DA_RESPOSTA = 'a semana tá fraca?';

const RESULTADO_DE_MENTIRA = {
  semana: '06/08/2026',
  unidade: 'guild points ganhos nas missões da guilda (não é XP)',
  ordem: 'menor',
  pontuaram_nesta_semana: 178,
  zeraram_nesta_semana: 18,
  media_desta_semana_entre_quem_pontuou: 2186,
  ganho_da_guilda_nesta_semana: 343497,
  soma_do_que_os_membros_ganharam: 432826,
  por_que_os_dois_totais_diferem: 'Membro pontua a cada partida que avança uma missão, mas a guilda '
    + 'só pontua quando um tier da missão fecha (mais as guild battles). A soma dos membros é '
    + 'normalmente maior e NÃO é o total da guilda. Ao falar do total da semana da guilda, use '
    + 'ganho_da_guilda_nesta_semana.',
  membros: [
    { nome: 'Fulano', contribuicao_na_semana: 120, posicao: 196 },
    { nome: 'Beltrano', contribuicao_na_semana: 340, posicao: 195 },
  ],
};

// O executor sabe a unidade e o modelo não: sem ela dita, ele preenche a lacuna e chamou os guild
// points de "XP" (relatado pela staff em 12/08/2026). No jogo XP é outra medida, ganha em qualquer
// partida, inclusive contra bot, e é justamente a que **não** conta como contribuição — a resposta
// sai plausível e ensina a coisa errada. Vale para qualquer ferramenta: o número é sempre o mesmo.
const UNIDADE_ERRADA = /\bxp\b/i;

// O outro jeito de a frase sair plausível e errada: os dois totais da semana medem coisas
// diferentes, e o dos membros é sempre o maior. A staff compara com o que vê no jogo, que é o da
// guilda — apresentar 432.826 onde o jogo mostra 343.497 é o erro relatado em 12/08/2026.
const TOTAL_DOS_MEMBROS = /432[.\s]?826/;
const TOTAL_DA_GUILDA = /343[.\s]?497/;

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

// A segunda chamada do `.ia`. Ela falhava calada por um mês: o 400 de thought_signature cai no
// `.catch` de handleIa, que devolve '' e deixa o embed sair só com os números - o comando parece
// funcionar e a frase, que é o comando inteiro, nunca aparece. Só o texto vazio denuncia.
console.log(`${linha}`);
try {
  await dormir(INTERVALO_MS);

  const escolha = await comRetry(() => escolherFerramenta({
    pergunta: PERGUNTA_DA_RESPOSTA,
    ferramentas: FERRAMENTAS,
    instrucao: INSTRUCAO_ESCOLHA,
  }));

  await dormir(INTERVALO_MS);

  const texto = await comRetry(() => redigirResposta({
    pergunta: PERGUNTA_DA_RESPOSTA,
    escolha,
    resultado: RESULTADO_DE_MENTIRA,
    instrucao: INSTRUCAO_RESPOSTA,
  }));

  if (!texto) {
    falhas.push('redigirResposta devolveu texto vazio - o embed sairia só com os números');
  } else {
    console.log(`  ok    a resposta é escrita: "${texto.slice(0, 90)}${texto.length > 90 ? '…' : ''}"`);

    if (UNIDADE_ERRADA.test(texto)) {
      console.log('  ERRO  a resposta chamou contribuição de XP');
      falhas.push('a resposta chamou os guild points de "XP" - XP é a medida que não conta como contribuição');
    } else {
      console.log('  ok    a unidade sai certa (guild points, não XP)');
    }

    if (TOTAL_DOS_MEMBROS.test(texto) && !TOTAL_DA_GUILDA.test(texto)) {
      console.log('  ERRO  a resposta deu a soma dos membros como total da guilda');
      falhas.push('a resposta usou a soma dos membros (432.826) como total da semana, em vez do ganho da guilda (343.497)');
    } else {
      console.log('  ok    o total da semana é o da guilda, não a soma dos membros');
    }
  }
} catch (e) {
  console.log(`  ERRO  redigirResposta: ${e.message.slice(0, 120)}`);
  falhas.push(`redigirResposta falhou: ${e.message.slice(0, 120)}`);
}

// O par declaração + executor é conferido pelo executores.mjs, que roda sem gastar cota.

console.log(linha);
console.log(`  ${CASOS.length - falhas.filter(f => f.startsWith('"')).length}/${CASOS.length} perguntas, ${gastas} requisições gastas`);
for (const f of falhas) console.log(`  ERRO  ${f}`);
console.log(`${linha}\n`);

// O grafo de imports deixa handle aberto (rate limiter do brawlhalla.js), então o processo não
// fecha sozinho.
process.exit(falhas.length ? 1 : 0);
