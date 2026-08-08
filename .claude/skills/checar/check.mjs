#!/usr/bin/env node
// Checagem estática do TGG-Bot. Não conecta no Discord e não escreve em lugar nenhum:
// só importa os módulos e lê os arquivos. Rode da raiz do projeto:  node .claude/skills/checar/check.mjs
import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
// Comandos que existem só por prefixo de propósito (brincadeira/interno) - ver CLAUDE.md
const PREFIX_ONLY = new Set(['crz', 'wam', 'bam']);
const HANDLER_FILES = ['src/public.js', 'src/admin.js', 'src/tggCoinsCommands.js'];
const EMOJI_OK = ['config/emojis.js'];

const errors = [];
const warns = [];
const ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const pass = (m) => ok.push(m);

// ─── 1. O grafo de imports carrega? ────────────────────────────────────────────
let commands, COMMAND_ALIASES, allSlashCommands;
try {
  const c = await import(pathToFileURL(join(ROOT, 'src/commands.js')).href);
  commands = c.commands;
  COMMAND_ALIASES = c.COMMAND_ALIASES;
  const b = await import(pathToFileURL(join(ROOT, 'src/slash/builders/index.js')).href);
  allSlashCommands = b.allSlashCommands;
  pass('grafo de imports carrega sem erro');
} catch (e) {
  console.error(`\n  FALHA AO CARREGAR OS MÓDULOS\n  ${e.message}\n`);
  console.error('  (import quebrado, erro de sintaxe, ou .env faltando)\n');
  process.exit(2);
}

const handlerNames = Object.keys(commands);
const builders = allSlashCommands.map((c) => c.toJSON());
const builderNames = new Set(builders.map((b) => b.name));

// ─── 2. Handler x builder ──────────────────────────────────────────────────────
const semBuilder = handlerNames.filter((n) => !builderNames.has(n) && !PREFIX_ONLY.has(n));
if (semBuilder.length) {
  err(`handler sem SlashCommandBuilder (existe só por prefixo): ${semBuilder.join(', ')}`);
  err('  → falta o builder em src/slash/builders/{public,admin,economy}.js');
} else {
  pass(`${handlerNames.length} handlers, ${builders.length} builders - todos pareados`);
}

const semHandler = [...builderNames].filter((n) => !handlerNames.includes(n));
if (semHandler.length) {
  err(`builder sem handler em commands (o /comando vai falhar): ${semHandler.join(', ')}`);
}

if (builders.length > 100) {
  err(`${builders.length} slash commands - o limite por guild é 100`);
}

// ─── 3. Higiene dos aliases ────────────────────────────────────────────────────
// O router faz: content.split(/\s+/) → .toLowerCase() → COMMAND_ALIASES[chave].
// Logo, chave com espaço ou maiúscula NUNCA casa com nada digitado.
for (const [alias, alvo] of Object.entries(COMMAND_ALIASES)) {
  if (alias !== alias.trim() || /\s/.test(alias)) {
    err(`alias inalcançável (tem espaço): ${JSON.stringify(alias)} → '${alvo}'`);
  } else if (alias !== alias.toLowerCase()) {
    err(`alias inalcançável (tem maiúscula): '${alias}' → '${alvo}'`);
  }
  if (!handlerNames.includes(alvo)) {
    err(`alias '${alias}' aponta para '${alvo}', que não existe em commands`);
  }
}

const semAlias = handlerNames.filter((n) => !Object.keys(COMMAND_ALIASES).includes(n));
if (semAlias.length) {
  warn(`comando sem alias próprio (não dá pra chamar por prefixo): ${semAlias.join(', ')}`);
}

// Chave duplicada some silenciosamente no objeto literal - só dá pra ver no texto
const src = readFileSync(join(ROOT, 'src/commands.js'), 'utf8');
const bloco = src.slice(src.indexOf('COMMAND_ALIASES = {'), src.indexOf('export const commands'));
const vistas = new Map();
for (const m of bloco.matchAll(/^\s*'([^']*)'\s*:/gm)) {
  vistas.set(m[1], (vistas.get(m[1]) || 0) + 1);
}
for (const [chave, n] of vistas) {
  if (n > 1) err(`alias '${chave}' declarado ${n}x - só o último vale`);
}
if (!errors.length) pass(`${Object.keys(COMMAND_ALIASES).length} aliases válidos`);

// ─── 4. Regras do Discord nos builders ─────────────────────────────────────────
for (const b of builders) {
  if (!/^[a-z0-9_-]{1,32}$/.test(b.name)) {
    err(`nome de slash inválido: '${b.name}' (só minúscula, número, - e _, até 32 chars)`);
  }
  if (!b.description || b.description.length > 100) {
    err(`descrição de /${b.name} vazia ou > 100 chars`);
  }
  for (const o of b.options || []) {
    if (!/^[a-z0-9_-]{1,32}$/.test(o.name)) {
      err(`opção inválida em /${b.name}: '${o.name}'`);
    }
    if (!o.description || o.description.length > 100) {
      err(`descrição da opção '${o.name}' em /${b.name} vazia ou > 100 chars`);
    }
  }
}

// ─── 5. Convenções do projeto ──────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const nome of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${nome}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (nome.endsWith('.js')) out.push(rel);
  }
  return out;
}
const arquivos = [...walk('src'), ...walk('utils'), ...walk('config')];

for (const f of arquivos) {
  const txt = readFileSync(join(ROOT, f), 'utf8');

  if (!EMOJI_OK.includes(f)) {
    const crus = [...txt.matchAll(/<a?:[a-zA-Z0-9_]+:[0-9]{15,}>/g)];
    if (crus.length) {
      warn(`${f}: ${crus.length} emoji(s) com ID colado - mover para config/emojis.js e usar EMOJIS.x`);
    }
  }

  if (HANDLER_FILES.includes(f)) {
    const n = [...txt.matchAll(/\.from\('/g)].length;
    if (n) warn(`${f}: ${n} chamada(s) diretas ao Supabase - o acesso devia passar por db.js/tggCoins.js`);
  }
}

// ─── Relatório ─────────────────────────────────────────────────────────────────
const linha = '─'.repeat(72);
console.log(`\n${linha}\n  CHECAGEM TGG-BOT\n${linha}`);
for (const m of ok) console.log(`  ok    ${m}`);
for (const m of warns) console.log(`  aviso ${m}`);
for (const m of errors) console.log(`  ERRO  ${m}`);
console.log(linha);
console.log(`  ${errors.length} erro(s), ${warns.length} aviso(s)`);
console.log(`${linha}\n`);

// Aviso não reprova: é dívida conhecida. Erro reprova: quebra em produção.
process.exit(errors.length ? 1 : 0);
