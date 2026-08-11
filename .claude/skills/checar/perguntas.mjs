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

const { FERRAMENTAS, EXECUTORES, INSTRUCAO_ESCOLHA, INSTRUCAO_RESPOSTA } = await importar('src/handlers/iaHandlers.js');
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
  // Fora do catálogo: sem `nao_sei_responder` o `mode: 'ANY'` obriga o modelo a escolher uma das
  // outras e a resposta sai confiante e errada. Ferramenta nova pode reabrir esse buraco.
  ['quantos membros a guilda tem?', 'nao_sei_responder'],
  ['quem entrou na guilda essa semana?', 'nao_sei_responder'],
  ['qual o elo mais alto da guilda?', 'nao_sei_responder'],
  ['quem tem mais TGG Coins?', 'nao_sei_responder'],
  ['contra quem a gente joga o duelo essa semana?', 'nao_sei_responder'],
  ['quantos jogos o Feijao fez essa semana?', 'nao_sei_responder'],
];

// Resultado inventado, com a forma que `ranking_contribuicao` devolve. Serve para checar a segunda
// chamada sem tocar no banco nem na API do Brawlhalla.
const RESULTADO_DE_MENTIRA = {
  semana: '06/08/2026',
  ordem: 'menor',
  membros: [
    { nome: 'Fulano', contribuicao: 120, posicao: 196 },
    { nome: 'Beltrano', contribuicao: 340, posicao: 195 },
  ],
};

// O free tier limita por minuto, não só por dia: 16 perguntas seguidas levam 429 no fim da lista
// (medido em 11/08/2026 — um minuto depois a mesma chave responde 200). O intervalo mantém o ritmo
// abaixo do teto e o retry cobre o caso de a lista crescer ou de o bot estar sendo usado junto.
const INTERVALO_MS = 5_000;
const ESPERA_APOS_429_MS = 65_000;

const linha = '─'.repeat(72);
const falhas = [];
let gastas = 0;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/** Uma tentativa a mais quando o 429 é de ritmo. Cota diária estourada falha nas duas. */
async function comRetry(fn) {
  gastas++;
  try {
    return await fn();
  } catch (e) {
    if (!e.message.includes('429')) throw e;
    console.log(`  ...  429 (limite por minuto), esperando ${ESPERA_APOS_429_MS / 1000}s`);
    await dormir(ESPERA_APOS_429_MS);
    gastas++;
    return fn();
  }
}

if (!iaConfigurada()) {
  console.error('\n  Falta a GEMINI_API_KEY no .env. Sem ela não dá para medir o roteamento.\n');
  process.exit(2);
}

/** Só os campos que o caso declara. String compara sem caixa: o modelo pode devolver o nome cru. */
function argumentosBatem(esperados, recebidos = {}) {
  return Object.entries(esperados).every(([chave, valor]) => {
    const veio = recebidos[chave];
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
    pergunta: 'quem contribuiu menos essa semana?',
    ferramentas: FERRAMENTAS,
    instrucao: INSTRUCAO_ESCOLHA,
  }));

  await dormir(INTERVALO_MS);

  const texto = await comRetry(() => redigirResposta({
    pergunta: 'quem contribuiu menos essa semana?',
    escolha,
    resultado: RESULTADO_DE_MENTIRA,
    instrucao: INSTRUCAO_RESPOSTA,
  }));

  if (texto) console.log(`  ok    a resposta é escrita: "${texto.slice(0, 90)}${texto.length > 90 ? '…' : ''}"`);
  else falhas.push('redigirResposta devolveu texto vazio - o embed sairia só com os números');
} catch (e) {
  console.log(`  ERRO  redigirResposta: ${e.message.slice(0, 120)}`);
  falhas.push(`redigirResposta falhou: ${e.message.slice(0, 120)}`);
}

// Declaração sem executor é "não sei responder" (handleIa trata assim), e hoje só
// `nao_sei_responder` é assim de propósito. Ferramenta nova sem executor é esquecimento.
for (const f of FERRAMENTAS) {
  if (!EXECUTORES[f.name] && f.name !== 'nao_sei_responder') {
    falhas.push(`${f.name} está declarada mas não tem executor - toda pergunta que cair nela vira "não sei responder"`);
  }
}

console.log(linha);
console.log(`  ${CASOS.length - falhas.filter(f => f.startsWith('"')).length}/${CASOS.length} perguntas, ${gastas} requisições gastas`);
for (const f of falhas) console.log(`  ERRO  ${f}`);
console.log(`${linha}\n`);

// O grafo de imports deixa handle aberto (rate limiter do brawlhalla.js), então o processo não
// fecha sozinho.
process.exit(falhas.length ? 1 : 0);
