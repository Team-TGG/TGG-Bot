#!/usr/bin/env node
// Vigia de guilda: registra quem entra e sai de outra guilda e cruza cada conta com a TGG.
// Rode da raiz do projeto:
//   node scripts/vigiar-guilda.mjs              uma leitura da BURLA e sai
//   node scripts/vigiar-guilda.mjs --loop       repete a cada 15 min até Ctrl+C
//   node scripts/vigiar-guilda.mjs --loop=30    idem, a cada 30 min
//   node scripts/vigiar-guilda.mjs 123456       outra guilda
//   node scripts/vigiar-guilda.mjs 123456 --de-olho=111,222
//                                               lê também os jogos dessas contas, modo a modo;
//                                               a lista fica gravada, não precisa repetir
//
// Só lê: API do Brawlhalla e Supabase. Nada de Discord, e tudo o que grava fica em
// vigia/<guild_id>/ (fora do git): estado.json, eventos.jsonl, relatorio.md, tgg.json,
// semana.json (base de guild points da semana), de-olho.jsonl (atividade das contas vigiadas) e
// pontos.jsonl (quanto a guilda e cada membro ganharam de uma leitura para a outra).
import 'dotenv/config';
import 'win-ca';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.env.IGNORE_SSL_ERRORS === 'true') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ROOT = process.cwd();
const GUILDA_PADRAO = '2599072'; // BURLA
const TGG_ID = process.env.BRAWLHALLA_CLAN_ID || '396943';
const INTERVALO_PADRAO_MIN = 15;
const INTERVALO_MINIMO_MIN = 5;
const ORDEM_DOS_RANKS = ['Recruit', 'Member', 'Officer', 'Leader'];

const args = process.argv.slice(2);
const guildId = args.find((a) => /^\d+$/.test(a)) ?? GUILDA_PADRAO;
const argLoop = args.find((a) => a.startsWith('--loop'));
const intervaloMin = argLoop
  ? Math.max(INTERVALO_MINIMO_MIN, Number(argLoop.split('=')[1]) || INTERVALO_PADRAO_MIN)
  : null;
const argDeOlho = args.find((a) => a.startsWith('--de-olho='));
const deOlhoPedido = argDeOlho ? argDeOlho.split('=')[1].split(',').filter((id) => /^\d+$/.test(id)) : null;
const API_KEY = process.env.BRAWLHALLA_API_KEY;

const DIR = join(ROOT, 'vigia', guildId);
const ARQ_ESTADO = join(DIR, 'estado.json');
const ARQ_EVENTOS = join(DIR, 'eventos.jsonl');
const ARQ_RELATORIO = join(DIR, 'relatorio.md');
const ARQ_TGG = join(DIR, 'tgg.json');
const ARQ_SEMANA = join(DIR, 'semana.json');
const ARQ_DE_OLHO = join(DIR, 'de-olho.jsonl');
const ARQ_PONTOS = join(DIR, 'pontos.jsonl');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const lerJson = (arq) => (existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : null);

// Grava num temporário e renomeia: Ctrl+C no meio da escrita não pode deixar o estado pela metade,
// porque estado ilegível na leitura seguinte viraria "todo mundo entrou de novo".
function gravarJson(arq, dados) {
  writeFileSync(`${arq}.tmp`, JSON.stringify(dados, null, 2), 'utf8');
  renameSync(`${arq}.tmp`, arq);
}

const FUSO = { timeZone: 'America/Sao_Paulo' };
const dataHora = (d) => new Date(d).toLocaleString('pt-BR', { ...FUSO, dateStyle: 'short', timeStyle: 'short' });
const soData = (d) => new Date(d).toLocaleDateString('pt-BR', FUSO);

// ---------------------------------------------------------------- API

// As rotas da v1 devolvem 404 e 5xx intermitentes para o que existe (ver docs/brawlhalla-api.md),
// então uma falha só não diz nada: repete antes de desistir da passada.
async function lerApi(url, tentativas = 4) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    if (i) await pausa(3000 * i);
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      ultimoErro = new Error(`HTTP ${res.status}`);
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro;
}

async function lerPlantel(id) {
  const dados = await lerApi(`https://api.brawlhalla.com/v1/guild/members?guild_id=${id}`);
  if (!Array.isArray(dados?.guild_members)) throw new Error('resposta sem guild_members');

  const membros = {};
  for (const m of dados.guild_members) {
    membros[String(m.brawlhalla_id)] = {
      name: m.name || '?',
      rank: m.rank ?? null,
      join_date: m.join_date ?? null,
      // Registro incompleto da API fica nulo: 0 faria a leitura seguinte contar o acumulado como ganho.
      guild_points: Number.isFinite(m.guild_points) ? m.guild_points : null,
      xp: Number.isFinite(m.xp) ? m.xp : null,
    };
  }
  return membros;
}

/**
 * Jogos de uma conta, modo a modo. Sai da v0: ela lista time de 2v2 com menos de 10 jogos (a v1
 * esconde até fechar a md10, e parceiro novo é justamente o que interessa ver) e traz 1v1, 2v2 e a
 * ranked rotativa numa chamada só. O geral vai nas duas versões porque, com conta vinculada, a v1
 * responde pela última conta em que a pessoa jogou (docs/brawlhalla-api.md, pegadinha 7) — medido
 * em 08/10/2026 na mesma conta: 26.122 jogos na v0 e 26.269 na v1. `null` = não foi lido.
 */
async function lerJogos(id) {
  if (!API_KEY) return null;

  const v0 = (rota) => lerApi(`https://api.brawlhalla.com/player/${id}/${rota}?api_key=${API_KEY}`, 2).catch(() => null);
  const modo = (d) => (Number.isFinite(d?.games) ? { games: d.games, wins: d.wins, rating: d.rating ?? null } : null);

  const geral = await v0('stats');
  // Conta que a v0 não achou volta 200 com objeto vazio
  if (!Number.isFinite(geral?.games)) return null;

  const ranked = await v0('ranked');
  const v1 = await lerApi(`https://api.brawlhalla.com/v1/player/stats?brawlhalla_id=${id}`, 2).catch(() => null);

  const times = {};
  for (const t of ranked?.['2v2'] ?? []) {
    // A v0 inventa um time do jogador com ninguém
    if (!t.brawlhalla_id_two) continue;
    const parceiro = String(t.brawlhalla_id_one) === String(id) ? t.brawlhalla_id_two : t.brawlhalla_id_one;
    times[parceiro] = { ...modo(t), nome: t.teamname };
  }

  return {
    ...modo(geral),
    level: geral.level ?? null,
    v1: modo(v1),
    '1v1': modo(ranked),
    rotativa: modo(ranked?.rotating_ranked),
    // Ranked ilegível não é "sem time": nulo impede a leitura seguinte de contar todos como novos
    times: ranked ? times : null,
  };
}

/** O que mudou entre duas leituras de `lerJogos`. Lado que não foi lido não entra na conta. */
function diferencaDeJogos(antes, agora) {
  if (!antes || !agora) return null;

  const par = (a, b) => (a && b
    ? { jogos: b.games - a.games, vitorias: b.wins - a.wins, eloAntes: a.rating ?? null, elo: b.rating ?? null }
    : null);

  const times = [];
  if (antes.times && agora.times) {
    for (const [parceiro, t] of Object.entries(agora.times)) {
      // Time que não existia é time novo de verdade: a v0 lista todos, então ausência é zero
      const d = par(antes.times[parceiro] ?? { games: 0, wins: 0 }, t);
      if (d.jogos > 0) times.push({ parceiro, nome: t.nome, ...d });
    }
  }

  return {
    geral: par(antes, agora),
    v1: par(antes.v1, agora.v1),
    '1v1': par(antes['1v1'], agora['1v1']),
    rotativa: par(antes.rotativa, agora.rotativa),
    times,
  };
}

function descreverJogos(d) {
  if (!d) return 'jogos: sem leitura';

  const um = (rotulo, p) => {
    if (!(p?.jogos > 0)) return null;
    const elo = p.elo != null && p.eloAntes != null && p.elo !== p.eloAntes ? `, elo ${p.eloAntes}→${p.elo}` : '';
    return `${rotulo} +${p.jogos} (${p.vitorias}V${elo})`;
  };

  const partes = [
    um('geral', d.geral),
    um('geral pela v1', d.v1),
    um('1v1', d['1v1']),
    ...d.times.map((t) => um(`2v2 [${t.nome}]`, t)),
    um('rotativa', d.rotativa),
  ].filter(Boolean);

  return partes.length ? partes.join(' · ') : 'nenhum jogo';
}

// ---------------------------------------------------------------- semana

// Quinta 06:00 no fuso do processo, a mesma virada de `getMissionWeekStart` do bot.
function inicioDaSemana(agora = new Date()) {
  const d = new Date(agora);
  d.setHours(6, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7));
  if (d > agora) d.setDate(d.getDate() - 7);
  return d;
}

/**
 * Base da semana: a primeira leitura de cada conta depois da virada. Guild points acumulam, então
 * ganho é sempre diferença entre duas leituras — e esta base é a primeira leitura **do vigia**, não a
 * quinta 06:00: o que foi pontuado antes de ele começar a rodar não aparece. Quem entra na guilda
 * (ou passa a ser vigiado) no meio da semana ganha base na leitura em que apareceu.
 */
function atualizarBase(agora, plantel, stats, jogos) {
  const semana = inicioDaSemana().toISOString();
  let base = lerJson(ARQ_SEMANA);
  if (base?.semana !== semana) base = { semana, lidaEm: agora, guilda: null, membros: {}, jogos: {} };

  if (stats) base.guilda ??= { guild_points: stats.guild_points ?? null, xp: stats.xp ?? null, desde: agora };
  for (const [id, m] of Object.entries(plantel)) {
    base.membros[id] ??= { guild_points: m.guild_points, xp: m.xp, desde: agora };
  }
  for (const [id, j] of Object.entries(jogos)) {
    if (j) base.jogos[id] ??= { ...j, desde: agora };
  }

  gravarJson(ARQ_SEMANA, base);
  return base;
}

const ganho = (antes, agora) => (antes == null || agora == null ? null : agora - antes);
const num = (n) => (n == null ? '—' : n.toLocaleString('pt-BR'));
const comSinal = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${num(n)}`);

/**
 * Elo de quem acabou de entrar: atual, pico e tier em 1v1, 2v2 (o melhor time) e 3v3. É da
 * temporada corrente, não da vida inteira. Modo sem partida devolve 404, o mesmo 404 que a rota dá
 * de vez em quando para conta que tem registro — então modo ausente é "sem registro", não "não joga".
 */
async function lerElo(id) {
  const tentar = (rota) => lerApi(`https://api.brawlhalla.com/v1/${rota}`, 2).catch(() => null);
  const modo = (d) => (d?.peak_rating ? { atual: d.rating, pico: d.peak_rating, tier: d.tier } : null);

  // Em série: disparadas juntas, as rotas por conta devolvem 502 (ver docs/brawlhalla-api.md)
  const v1 = await tentar(`player/stats?brawlhalla_id=${id}&mode=ranked_1v1`);
  const times = (await tentar(`player/teams?brawlhalla_id=${id}`))?.teams?.ranked_2v2 ?? [];
  const v3 = await tentar(`player/stats?brawlhalla_id=${id}&mode=ranked_3v3`);
  const melhorTime = times.reduce((m, t) => (t.peak_rating > (m?.peak_rating ?? 0) ? t : m), null);

  const elo = { '1v1': modo(v1), '2v2': modo(melhorTime), '3v3': modo(v3) };
  return Object.values(elo).some(Boolean) ? elo : null;
}

function descreverElo(elo) {
  if (!elo) return 'elo: sem registro na temporada';
  return 'elo ' + Object.entries(elo)
    .filter(([, e]) => e)
    .map(([m, e]) => `${m} ${e.atual} (pico ${e.pico}, ${e.tier})`)
    .join(' · ');
}

// ---------------------------------------------------------------- TGG

// O PostgREST corta o select sem avisar; quem lê tabela inteira precisa paginar.
async function lerTudo(montar) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

/**
 * Tudo o que se sabe sobre a TGG, num objeto que cabe em JSON: quem está na guilda agora (API),
 * quem já passou por ela (`guild_membership_history` + cadastro em `users`) e as contas vinculadas.
 */
async function lerTgg() {
  const { getClient } = await import(pathToFileURL(join(ROOT, 'src/db.js')).href);
  const supabase = getClient();

  const [plantel, usuarios, historico, alts, altsDeConquista] = await Promise.all([
    lerPlantel(TGG_ID),
    lerTudo(() => supabase.from('users').select('brawlhalla_id, username, discord_id, active').order('id')),
    lerTudo(() => supabase.from('guild_membership_history')
      .select('brawlhalla_id, nome, action, occurred_at').order('occurred_at').order('id')),
    lerTudo(() => supabase.from('alt_ids').select('alt_id, main_id').order('id')),
    lerTudo(() => supabase.from('tgg_coins_achievements_alts').select('alt_id, main_id').order('id')),
  ]);

  const contas = {};
  const conta = (id) => (contas[String(id)] ??= {});

  for (const u of usuarios) {
    if (!u.brawlhalla_id) continue;
    Object.assign(conta(u.brawlhalla_id), { nome: u.username, discordId: u.discord_id, ativo: u.active });
  }
  for (const h of historico) {
    const c = conta(h.brawlhalla_id);
    c.nome ??= h.nome;
    // `occurred_at` é UTC gravado sem fuso (medido em 06/10/2026: linha das 17:00 lida às 14:19 de
    // Brasília). Sem o Z o Node lê como hora local e saída à noite cai no dia errado.
    const quando = /Z|[+-]\d\d:?\d\d$/.test(h.occurred_at) ? h.occurred_at : `${h.occurred_at}Z`;
    if (h.action === 'entrou') c.entrou = quando;
    if (h.action === 'saiu') c.saiu = quando;
  }
  for (const [id, m] of Object.entries(plantel)) conta(id).nome ??= m.name;

  const vinculos = {};
  for (const { alt_id, main_id } of [...alts, ...altsDeConquista]) {
    const [a, b] = [String(alt_id), String(main_id)];
    (vinculos[a] ??= []).push(b);
    (vinculos[b] ??= []).push(a);
  }

  return { lidoEm: new Date().toISOString(), naGuilda: Object.keys(plantel), contas, vinculos };
}

// Falha de leitura cai na última cópia boa: marcar um evento como "sem ligação com a TGG" porque o
// Supabase tossiu naquela passada seria informação errada gravada para sempre no log.
async function carregarTgg() {
  try {
    const tgg = await lerTgg();
    gravarJson(ARQ_TGG, tgg);
    return tgg;
  } catch (err) {
    const copia = lerJson(ARQ_TGG);
    console.warn(`  ! TGG não pôde ser lida (${err.message}) — ` +
      (copia ? `usando a cópia de ${dataHora(copia.lidoEm)}` : 'cruzamento indisponível nesta passada'));
    return copia;
  }
}

/**
 * Ligação de uma conta com a TGG. `undefined` = não deu para saber (TGG ilegível), `null` = nunca
 * passou pela TGG. A ligação pode ser da própria conta ou de uma conta vinculada a ela.
 */
function cruzar(tgg, id) {
  if (!tgg) return undefined;

  const vinculadas = (tgg.vinculos[id] ?? []).filter((v) => tgg.contas[v]);
  const direta = Boolean(tgg.contas[id]);
  if (!direta && !vinculadas.length) return null;

  const candidatas = direta ? [id, ...vinculadas] : vinculadas;
  const contaNaTgg = candidatas.find((c) => tgg.naGuilda.includes(c)) ?? null;
  const ref = contaNaTgg ?? candidatas[0];
  const dados = tgg.contas[ref];

  return {
    vinculo: ref === id ? 'direta' : 'vinculada',
    conta: ref,
    nome: dados.nome ?? null,
    discordId: tgg.contas[id]?.discordId ?? dados.discordId ?? null,
    naTggAgora: Boolean(contaNaTgg),
    entrou: dados.entrou ?? null,
    saiu: dados.saiu ?? null,
  };
}

function descreverTgg(t) {
  if (t === undefined) return 'TGG: não foi possível conferir';
  if (t === null) return '';

  const quem = t.vinculo === 'vinculada' ? `conta vinculada ${t.nome ?? '?'} (${t.conta})` : (t.nome ?? '?');
  if (t.naTggAgora) return `NA TGG AGORA — ${quem}`;
  return `EX-TGG — ${quem}, ${t.saiu ? `saiu em ${soData(t.saiu)}` : 'sem data de saída registrada'}`;
}

// ---------------------------------------------------------------- comparação

function comparar(antes, agora) {
  const eventos = [];

  for (const [id, m] of Object.entries(agora)) {
    const a = antes[id];
    if (!a) {
      eventos.push({ acao: 'entrou', brawlhalla_id: id, ...m });
    } else if (a.rank && m.rank && a.rank !== m.rank) {
      const subiu = ORDEM_DOS_RANKS.indexOf(m.rank) > ORDEM_DOS_RANKS.indexOf(a.rank);
      eventos.push({ acao: subiu ? 'promovido' : 'rebaixado', brawlhalla_id: id, ...m, rankAnterior: a.rank });
    }
  }
  for (const [id, a] of Object.entries(antes)) {
    if (!agora[id]) eventos.push({ acao: 'saiu', brawlhalla_id: id, name: a.name, rank: a.rank, join_date: a.join_date });
  }

  return eventos;
}

const lerEventos = () => (existsSync(ARQ_EVENTOS)
  ? readFileSync(ARQ_EVENTOS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

// ---------------------------------------------------------------- relatório

const SINAL = { entrou: '+', saiu: '-', promovido: '↑', rebaixado: '↓' };
const celula = (v) => String(v ?? '—').replaceAll('|', '\\|');

function linhaDeMembro(id, m, t) {
  const quando = m.join_date ? soData(m.join_date * 1000) : '—';
  const naTgg = t.vinculo === 'vinculada' ? `${t.nome ?? '?'} (${t.conta}, vinculada)` : t.nome;
  const situacao = t.naTggAgora ? 'na TGG agora' : (t.saiu ? `saiu em ${soData(t.saiu)}` : 'sem data de saída');
  const discord = t.discordId ? `<@${t.discordId}>` : '—';
  return `| ${celula(m.name)} | ${id} | ${celula(m.rank)} | ${quando} | ${celula(naTgg)} | ${situacao} | ${discord} |`;
}

const lerAtividade = () => (existsSync(ARQ_DE_OLHO)
  ? readFileSync(ARQ_DE_OLHO, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

function linhaDeAtividade(a) {
  return `${comSinal(a.pontos)} pts · ${comSinal(a.xp)} XP de guilda · ${descreverJogos(a.jogos)}`;
}

function blocoDeOlho(id, estado, base, atividade) {
  const m = estado.membros[id];
  const j = estado.jogos?.[id];
  const b = base.membros[id];
  const nome = m?.name ?? atividade.findLast((a) => a.brawlhalla_id === id)?.name ?? '?';
  const out = [`### De olho: ${nome} (${id})`, ''];

  if (m) {
    out.push(
      `${m.rank ?? '—'} · entrou lá em ${m.join_date ? soData(m.join_date * 1000) : '—'}` + (j?.level ? ` · level ${j.level}` : ''),
      '',
      `- Guild points: **${num(m.guild_points)}** (${comSinal(ganho(b?.guild_points, m.guild_points))} desde ${dataHora(b?.desde ?? base.lidaEm)})`,
      `- XP de guilda: ${num(m.xp)} (${comSinal(ganho(b?.xp, m.xp))})`,
    );
  } else {
    out.push('**Não está no plantel desta leitura.**', '');
  }

  if (j) {
    const modo = (rotulo, d) => (d ? `${rotulo} ${num(d.games)} jogos, ${num(d.wins)}V${d.rating ? `, elo ${d.rating}` : ''}` : null);
    out.push(
      `- Jogos na semana: ${descreverJogos(diferencaDeJogos(base.jogos[id], j))}`,
      `- Totais: ${[modo('geral', j), modo('geral pela v1', j.v1), modo('1v1', j['1v1']), modo('rotativa', j.rotativa)].filter(Boolean).join(' · ')}`,
    );
    const times = Object.entries(j.times ?? {}).sort(([, a], [, b]) => b.games - a.games);
    if (times.length) {
      out.push('- Times de 2v2 na temporada:');
      // O parceiro que está no plantel é o que diz com quem da guilda ele joga
      for (const [parceiro, t] of times) {
        out.push(`  - ${t.nome} (${parceiro})${estado.membros[parceiro] ? ' — **da guilda**' : ''}: ${num(t.games)} jogos, ${num(t.wins)}V, elo ${t.rating ?? '—'}`);
      }
    }
  } else {
    out.push('- Jogos: sem leitura.');
  }

  const dele = atividade.filter((a) => a.brawlhalla_id === id).slice(-50).reverse();
  out.push('', dele.length ? 'Atividade, da mais recente para a mais antiga (cada linha é o que mudou entre duas leituras):' : 'Nenhuma atividade registrada entre leituras ainda.', '');
  for (const a of dele) out.push(`- ${dataHora(a.quando)} — ${linhaDeAtividade(a)}`);
  if (dele.length) out.push('');

  return out;
}

function secaoDaSemana(estado, base, atividade) {
  const linhas = Object.entries(estado.membros).map(([id, m]) => {
    const b = base.membros[id];
    return { id, m, pontos: ganho(b?.guild_points, m.guild_points), xp: ganho(b?.xp, m.xp) };
  });
  const ativos = linhas
    .filter((l) => l.pontos > 0 || l.xp > 0)
    .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0) || (b.xp ?? 0) - (a.xp ?? 0));
  const g = estado.guilda;

  return [
    `## Semana de ${soData(base.semana)} — ganho desde ${dataHora(base.lidaEm)}`,
    '',
    'A base é a primeira leitura do vigia na semana, não a virada de quinta 06:00: o que foi pontuado',
    'antes dela não aparece. XP de guilda sobe em qualquer partida e serve só de volume de jogo.',
    '',
    g
      ? `Guilda: **${num(g.guild_points)}** guild points (${comSinal(ganho(base.guilda?.guild_points, g.guild_points))}) · ` +
        `XP ${num(g.xp)} (${comSinal(ganho(base.guilda?.xp, g.xp))}) · ${g.rank ?? '—'}º no ranking`
      : 'Guilda: totais não lidos.',
    '',
    ...(estado.deOlho ?? []).flatMap((id) => blocoDeOlho(id, estado, base, atividade)),
    `### Quem pontuou ou jogou (${ativos.length} de ${linhas.length})`,
    '',
    ...(ativos.length
      ? [
          '| Nick | Brawlhalla ID | Rank | Guild points | Ganho | XP de guilda ganho |',
          '| :-- | :-- | :-- | --: | --: | --: |',
          ...ativos.map((l) => `| ${celula(l.m.name)} | ${l.id} | ${celula(l.m.rank)} | ${num(l.m.guild_points)} | ${comSinal(l.pontos)} | ${comSinal(l.xp)} |`),
        ]
      : ['Ninguém ainda.']),
    '',
  ];
}

function montarRelatorio(estado, tgg, eventos, base, atividade) {
  const cruzados = Object.entries(estado.membros).map(([id, m]) => [id, m, cruzar(tgg, id)]);
  const exTgg = cruzados.filter(([, , t]) => t && !t.naTggAgora);
  const nasDuas = cruzados.filter(([, , t]) => t?.naTggAgora);
  const cabecalho = [
    '| Nick na guilda | Brawlhalla ID | Rank | Entrou lá em | Nome na TGG | Situação na TGG | Discord |',
    '| :-- | :-- | :-- | :-- | :-- | :-- | :-- |',
  ];
  const tabela = (linhas) => (linhas.length
    ? [...cabecalho, ...linhas.map(([id, m, t]) => linhaDeMembro(id, m, t))]
    : ['Ninguém.']);

  const saidas = eventos.filter((e) => e.acao === 'saiu');
  const out = [
    `# Vigia da guilda ${estado.nome ?? estado.guildId} (${estado.guildId})`,
    '',
    `Vigiando desde ${dataHora(estado.primeiraLeitura)} · última leitura ${dataHora(estado.ultimaLeitura)} · ` +
      `${Object.keys(estado.membros).length} membros · ${eventos.length} eventos registrados`,
    '',
    tgg
      ? `Cruzamento com a TGG lido em ${dataHora(tgg.lidoEm)}.`
      : '**Cruzamento com a TGG indisponível nesta leitura.**',
    '',
    ...secaoDaSemana(estado, base, atividade),
    `## Já foram da TGG e estão lá agora (${exTgg.length})`,
    '',
    ...tabela(exTgg),
    '',
    `## Constam na TGG agora e também lá (${nasDuas.length})`,
    '',
    'Conta vinculada de alguém que está na TGG, ou a mesma conta nas duas listas — a API demora',
    'cerca de um dia para tirar quem saiu, então mesma conta nas duas é mudança recente.',
    '',
    ...tabela(nasDuas),
    '',
    `## Saíram de lá desde o início da vigia (${saidas.length})`,
    '',
    ...(saidas.length
      ? saidas.slice().reverse().map((e) => {
          const t = descreverTgg(cruzar(tgg, e.brawlhalla_id));
          return `- ${dataHora(e.quando)} — ${e.name} (${e.brawlhalla_id})${t ? ` — ${t}` : ''}`;
        })
      : ['Ninguém.']),
    '',
    '## Últimos eventos',
    '',
    ...(eventos.length
      ? eventos.slice(-100).reverse().map((e) => `- ${dataHora(e.quando)} — ${linhaDeEvento(e)}`)
      : ['Nenhum ainda.']),
    '',
  ];

  return out.join('\n');
}

function linhaDeEvento(e) {
  const rank = e.rankAnterior ? `${e.rankAnterior} → ${e.rank}` : (e.rank ?? '—');
  const t = descreverTgg(e.tgg);
  const elo = e.acao === 'entrou' ? ` — ${descreverElo(e.elo)}` : '';
  return `${SINAL[e.acao]} ${e.acao.padEnd(9)} ${e.name} (${e.brawlhalla_id}) · ${rank}${elo}${t ? ` — ${t}` : ''}`;
}

// ---------------------------------------------------------------- passada

async function passada() {
  const agora = new Date().toISOString();
  const plantel = await lerPlantel(guildId);

  // Lista vazia é leitura ruim, não debandada: registrar daria uma saída para cada membro agora
  // e uma entrada para cada um na leitura seguinte.
  if (!Object.keys(plantel).length) throw new Error('a API devolveu a guilda sem nenhum membro');

  const stats = await lerApi(`https://api.brawlhalla.com/v1/guild/stats?guild_id=${guildId}`, 2).catch(() => null);
  const tgg = await carregarTgg();
  const anterior = lerJson(ARQ_ESTADO);

  const eventos = anterior ? comparar(anterior.membros, plantel) : [];
  for (const e of eventos) {
    e.quando = agora;
    e.tgg = cruzar(tgg, e.brawlhalla_id);
    // `undefined` some no JSON; "não deu para conferir" precisa continuar distinguível de "nunca foi da TGG"
    if (e.tgg === undefined) e.tggIndisponivel = true;
    if (e.acao === 'entrou') e.elo = await lerElo(e.brawlhalla_id);
    appendFileSync(ARQ_EVENTOS, `${JSON.stringify(e)}\n`, 'utf8');
  }

  for (const [id, m] of Object.entries(plantel)) m.vistoDesde = anterior?.membros[id]?.vistoDesde ?? agora;

  const deOlho = deOlhoPedido ?? anterior?.deOlho ?? [];
  const jogos = {};
  // Em série, como o elo: poucas contas, e as rotas por conta falham em rajada
  for (const id of deOlho) jogos[id] = await lerJogos(id);
  const base = atualizarBase(agora, plantel, stats, jogos);

  const atividadeNova = [];
  for (const id of deOlho) {
    const [m, a] = [plantel[id], anterior?.membros[id]];
    const linha = {
      quando: agora,
      brawlhalla_id: id,
      name: m?.name ?? a?.name ?? '?',
      pontos: ganho(a?.guild_points, m?.guild_points),
      xp: ganho(a?.xp, m?.xp),
      jogos: diferencaDeJogos(anterior?.jogos?.[id], jogos[id]),
    };
    if (linha.pontos > 0 || linha.xp > 0 || linha.jogos?.geral?.jogos > 0 || linha.jogos?.v1?.jogos > 0) {
      appendFileSync(ARQ_DE_OLHO, `${JSON.stringify(linha)}\n`, 'utf8');
      atividadeNova.push(linha);
    }
  }

  const estado = {
    guildId,
    nome: stats?.name ?? anterior?.nome ?? null,
    primeiraLeitura: anterior?.primeiraLeitura ?? agora,
    ultimaLeitura: agora,
    guilda: stats
      ? { guild_points: stats.guild_points ?? null, xp: stats.xp ?? null, rank: stats.rank ?? null }
      : (anterior?.guilda ?? null),
    deOlho,
    // Leitura que falhou mantém a anterior: a diferença seguinte cobre o intervalo todo em vez de sumir
    jogos: Object.fromEntries(deOlho.map((id) => [id, jogos[id] ?? anterior?.jogos?.[id] ?? null])),
    membros: plantel,
  };
  gravarJson(ARQ_ESTADO, estado);

  // O total da guilda só anda em tier de missão e em guild battle, e a API não diz qual foi. O que
  // dá para cruzar é quem pontuou na mesma janela — por isso o ganho de todos, não só dos vigiados.
  // Negativo entra: é quem saiu e voltou, e os pontos zeram.
  if (anterior) {
    const membros = {};
    for (const [id, m] of Object.entries(plantel)) {
      const g = ganho(anterior.membros[id]?.guild_points, m.guild_points);
      if (g) membros[id] = g;
    }
    const guilda = ganho(anterior.guilda?.guild_points, estado.guilda?.guild_points);
    if (guilda || Object.keys(membros).length) {
      appendFileSync(ARQ_PONTOS, `${JSON.stringify({ quando: agora, guilda, membros })}\n`, 'utf8');
    }
  }

  writeFileSync(ARQ_RELATORIO, montarRelatorio(estado, tgg, lerEventos(), base, lerAtividade()), 'utf8');

  const total = Object.keys(plantel).length;
  const rotulo = `[${dataHora(agora)}] ${estado.nome ?? guildId}: ${total} membros`;

  if (!anterior) {
    console.log(`${rotulo} — primeira leitura, base gravada (entradas e saídas aparecem a partir da próxima)`);
    const ligados = Object.entries(plantel).map(([id, m]) => [id, m, cruzar(tgg, id)]).filter(([, , t]) => t);
    console.log(`  ${ligados.length} com ligação com a TGG:`);
    for (const [id, m, t] of ligados) console.log(`    ${m.name} (${id}) · ${m.rank ?? '—'} — ${descreverTgg(t)}`);
  } else if (!eventos.length) {
    console.log(`${rotulo} — sem mudança`);
  } else {
    console.log(`${rotulo} — ${eventos.length} mudança(s)`);
    for (const e of eventos) console.log(`  ${linhaDeEvento(e)}`);
  }

  const pontuaram = Object.entries(plantel)
    .filter(([id, m]) => ganho(anterior?.membros[id]?.guild_points, m.guild_points) > 0).length;
  console.log(`  semana: guilda ${comSinal(ganho(base.guilda?.guild_points, estado.guilda?.guild_points))} pts desde ` +
    `${dataHora(base.lidaEm)} · ${pontuaram} membro(s) pontuaram desde a última leitura`);

  for (const id of deOlho) {
    const m = plantel[id];
    const nova = atividadeNova.find((a) => a.brawlhalla_id === id);
    const resumo = m
      ? `${m.name}: ${num(m.guild_points)} pts (${comSinal(ganho(base.membros[id]?.guild_points, m.guild_points))} na semana)`
      : `${id}: fora do plantel`;
    console.log(`  de olho — ${resumo} — ${nova ? linhaDeAtividade(nova) : (jogos[id] ? 'parado desde a última leitura' : 'jogos sem leitura')}`);
  }
}

mkdirSync(DIR, { recursive: true });
console.log(`Vigiando a guilda ${guildId}. Arquivos em ${DIR}`);

do {
  try {
    await passada();
  } catch (err) {
    // Passada que falha não toca no estado: a próxima compara contra a última leitura boa.
    console.error(`[${dataHora(Date.now())}] leitura falhou, nada foi gravado: ${err.message}`);
    if (!intervaloMin) process.exitCode = 1;
  }
  if (intervaloMin) await pausa(intervaloMin * 60 * 1000);
} while (intervaloMin);
