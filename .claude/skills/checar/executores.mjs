#!/usr/bin/env node
// Executores do `.ia`: roda cada ferramenta de verdade e confere o que ela devolve.
// Rode da raiz do projeto:  node .claude/skills/checar/executores.mjs
//
// O irmão perguntas.mjs testa o roteamento — qual ferramenta a IA escolhe. Este testa o outro
// lado: o que a ferramenta escolhida produz. A divisão importa porque um passou verde enquanto o
// outro estava quebrado: em 11/08/2026 o roteamento marcava 19/19 enquanto todo embed cortava a
// lista em 15 linhas sem avisar, escondendo 7 MVPs e 16 dos 31 da prévia de inativação.
//
// Só lê: banco e API do Brawlhalla, nada de Discord e nada de Gemini (não gasta cota).
import 'dotenv/config';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const importar = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const { FERRAMENTAS, EXECUTORES } = await importar('src/handlers/iaHandlers.js');

// Limites do Discord. Passar deles derruba a mensagem inteira, e o erro só aparece no canal.
const MAX_CAMPO = 1024;
const MAX_NOME_CAMPO = 256;
const MAX_TITULO = 256;

// Busca larga de propósito em alguns casos: é assim que se alcança o caminho de lista longa, que
// é onde mora o bug de truncagem. `nome: 'a'` casou com 121 membros em 11/08/2026.
const CASOS = [
  ['ranking_contribuicao', {}],
  ['ranking_contribuicao', { ordem: 'menor', limite: 15 }],
  ['media_de_contribuicao', {}],
  ['media_de_contribuicao', { ordem: 'menor', limite: 15 }],
  ['mvps_da_semana', {}],
  ['inativos_da_semana', {}],
  ['contribuicao_de_membro', { nome: 'a' }],
  ['contribuicao_de_membro', { nome: 'zzzznaoexiste' }],
  ['jogos_de_membro', { nome: 'a' }, { listaLonga: true }],
  ['jogos_de_membro', { nome: 'zzzznaoexiste' }],
  ['movimentacao_da_guilda', {}],
  ['movimentacao_da_guilda', { dias: 7 }],
  ['duelo_da_semana', {}],
  // O "eu": nome vazio resolve pelo discord_id de quem perguntou. O autor é lido do banco na hora
  // (ver `autorDeVerdade`) porque cravar um ID aqui quebraria o teste quando essa pessoa saísse.
  ['contribuicao_de_membro', {}, { comoAutor: true, exigeEncontrado: true }],
  ['jogos_de_membro', {}, { comoAutor: true, exigeEncontrado: true }],
  ['contribuicao_de_membro', { nome: 'eu' }, { comoAutor: true, exigeEncontrado: true }],
  // Sem autor no contexto (ou autor sem cadastro) a resposta é "não achei", nunca um estouro
  ['contribuicao_de_membro', {}, { semAutor: true }],
  ['contribuicao_de_membro', {}, { autorFalso: true }],
];

const linha = '─'.repeat(72);
const falhas = [];
const err = (m) => falhas.push(m);

/**
 * `discord_id` e `brawlhalla_id` nunca podem sair daqui: o que o executor devolve vai para o
 * provedor de IA, e o free tier pode usar o conteúdo para treino. Ferramenta nova que devolva a
 * linha do banco crua vaza os dois sem ninguém perceber.
 */
function procurarIdentificadores(valor, caminho = 'dados') {
  if (valor === null || valor === undefined) return [];

  if (Array.isArray(valor)) return valor.flatMap((v, i) => procurarIdentificadores(v, `${caminho}[${i}]`));

  if (typeof valor === 'object') {
    return Object.entries(valor).flatMap(([chave, v]) => (
      /discord_?id|brawlhalla_?id/i.test(chave)
        ? [`${caminho}.${chave} é identificador de membro`]
        : procurarIdentificadores(v, `${caminho}.${chave}`)
    ));
  }

  // Snowflake do Discord e id do Brawlhalla são numéricos longos; nome de jogador não é.
  if (typeof valor === 'string' && /^\d{7,}$/.test(valor)) {
    return [`${caminho} parece um identificador ("${valor}")`];
  }

  return [];
}

/**
 * Um discord_id de verdade, com cadastro e conta na guilda, para exercitar o caminho do "eu".
 * Sai do banco em vez de estar cravado aqui: ID fixo faz o teste falhar no dia em que a pessoa sai.
 */
async function autorDeVerdade() {
  const { getActiveUsersWithBrawlhallaId } = await importar('src/db.js');
  const users = await getActiveUsersWithBrawlhallaId();
  const escolhido = users.find(u => u.discord_id && u.brawlhalla_id);

  if (!escolhido) err('nenhum usuário ativo com discord_id e brawlhalla_id - o caminho do "eu" não foi testado');

  return escolhido ? String(escolhido.discord_id) : null;
}

console.log(`\n${linha}\n  EXECUTORES DO .ia\n${linha}`);

const AUTOR = await autorDeVerdade();

// Estrutural: par declaração + executor. `nao_sei_responder` é a exceção documentada — handleIa
// trata ferramenta sem executor como "não sei responder", que é a resposta certa para ela.
for (const f of FERRAMENTAS) {
  if (!EXECUTORES[f.name] && f.name !== 'nao_sei_responder') {
    err(`${f.name}: declarada para a IA e sem executor — toda pergunta que cair nela vira "não sei responder"`);
  }
}

const declaradas = new Set(FERRAMENTAS.map(f => f.name));
for (const nome of Object.keys(EXECUTORES)) {
  if (!declaradas.has(nome)) err(`${nome}: tem executor e não está em FERRAMENTAS — a IA nunca vai escolher`);
}

for (const [nome, args, opcoes = {}] of CASOS) {
  const contexto = opcoes.semAutor ? {}
    : opcoes.autorFalso ? { discordId: '000000000000000001' }
      : opcoes.comoAutor ? { discordId: AUTOR }
        : {};

  const sufixo = opcoes.comoAutor ? ' [como autor]' : opcoes.semAutor ? ' [sem autor]' : opcoes.autorFalso ? ' [autor sem cadastro]' : '';
  const rotulo = `${nome}(${JSON.stringify(args)})${sufixo}`;
  const executor = EXECUTORES[nome];

  if (!executor) {
    err(`${rotulo}: sem executor`);
    continue;
  }

  if (opcoes.comoAutor && !AUTOR) continue;

  let resultado;

  try {
    resultado = await executor(args, contexto);
  } catch (e) {
    err(`${rotulo}: estourou — ${e.message}`);
    console.log(`  ERRO ${rotulo}: ${e.message}`);
    continue;
  }

  const { dados, titulo, campos, rodape } = resultado ?? {};
  const problemas = [];

  if (!dados || typeof dados !== 'object') problemas.push('dados vazio');
  if (!titulo) problemas.push('sem titulo');
  if (titulo && titulo.length > MAX_TITULO) problemas.push(`titulo com ${titulo.length} caracteres`);
  if (!rodape) problemas.push('sem rodape');
  if (!Array.isArray(campos) || !campos.length) problemas.push('sem campos');

  for (const campo of campos ?? []) {
    if (!campo?.name) problemas.push('campo sem name');
    if (!campo?.value) problemas.push(`campo "${campo?.name}" sem value`);
    if (campo?.name?.length > MAX_NOME_CAMPO) problemas.push(`name de "${campo.name}" com ${campo.name.length} caracteres`);
    if (campo?.value?.length > MAX_CAMPO) problemas.push(`value de "${campo.name}" com ${campo.value.length} caracteres (teto ${MAX_CAMPO})`);
  }

  // O bug de 11/08/2026: lista cortada tem que dizer que foi cortada. Sem o aviso a resposta
  // parece completa, e ninguém sabe que existe mais gente.
  if (opcoes.listaLonga) {
    const maior = (campos ?? []).reduce((a, c) => (c.value?.length ?? 0) > (a.value?.length ?? 0) ? c : a, {});
    if (!/e mais \d+/.test(maior.value ?? '')) {
      problemas.push('lista longa sem o aviso "… e mais N" — o corte estaria calado');
    }
  }

  // "eu" com autor de verdade tem que achar a pessoa e dizer que a resposta é sobre ela — é o que
  // faz a IA escrever "você contribuiu" em vez do apelido.
  if (opcoes.exigeEncontrado) {
    if (!dados?.encontrado) problemas.push('não encontrou quem perguntou');
    else if (!dados?.sobre_quem_perguntou) problemas.push('encontrou, mas não marcou sobre_quem_perguntou');
  }

  // Sem autor utilizável a saída é "não achei" com motivo, nunca uma resposta sobre outra pessoa
  if ((opcoes.semAutor || opcoes.autorFalso) && dados?.encontrado !== false) {
    problemas.push('sem autor identificável deveria voltar encontrado: false');
  }

  problemas.push(...procurarIdentificadores(dados));

  const tamanhos = (campos ?? []).map(c => c.value?.length ?? 0).join('/');
  console.log(`  ${problemas.length ? 'ERRO' : 'ok  '} ${rotulo} — ${campos?.length ?? 0} campo(s), ${tamanhos} caracteres`);
  problemas.forEach(p => err(`${rotulo}: ${p}`));
}

console.log(linha);
console.log(`  ${CASOS.length - new Set(falhas.map(f => f.split(':')[0])).size}/${CASOS.length} casos limpos`);
for (const f of falhas) console.log(`  ERRO  ${f}`);
console.log(`${linha}\n`);

// O grafo de imports deixa handle aberto (rate limiter do brawlhalla.js): sem isso não fecha.
process.exit(falhas.length ? 1 : 0);
