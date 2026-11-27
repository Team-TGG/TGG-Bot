import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRankedQueueService, emptyQueueState, normalizeQueueRow, queueName, QUEUE_POLL_MS, QUEUE_ACTIVE_MS, QUEUE_PAGES, validQueueState } from '../src/services/rankedQueueService.js';
import { createRankedQueueStore } from '../src/rankedQueueStore.js';

const row = (patch = {}) => ({ brawlhalla_id: 42, name: 'Jogador TGG', games: 100, wins: 60, rating: 2466, peak_rating: 2504, rank: 86, tier: 'Diamond', ...patch });
const team = (first, second, patch = {}) => row({ brawlhalla_id_one: first, brawlhalla_id_two: second, teamname: 'Alpha + Beta', ...patch });

function fixture(saved = emptyQueueState()) {
  let state = structuredClone(saved), time = 1_000_000, calls = 0;
  const data = { '1v1': [row()], '2v2': [team(10, 20)] };
  const errors = new Set();
  const store = { read: async () => structuredClone(state), write: async next => { state = structuredClone(next); } };
  const fetchPage = async (mode, page) => { calls++; if (errors.has(`${mode}:${page}`)) throw new Error('offline'); return page === 1 ? structuredClone(data[mode]) : []; };
  const service = createRankedQueueService({ store, fetchPage, now: () => time, logger: { warn() {} } });
  return { service, store, fetchPage, data, errors, advance: (milliseconds = QUEUE_POLL_MS) => { time += milliseconds; }, get state() { return structuredClone(state); }, get calls() { return calls; }, now: () => time };
}

test('duplas têm identidade pelo par de IDs, sem colisão de somas nem mudança ao inverter a ordem', () => {
  assert.notEqual(normalizeQueueRow(team(1, 4), '2v2').id, normalizeQueueRow(team(2, 3), '2v2').id);
  assert.equal(normalizeQueueRow(team(1, 4), '2v2').id, normalizeQueueRow(team(4, 1), '2v2').id);
  assert.throws(() => normalizeQueueRow(team(1, 1), '2v2'), { queueCode: 'RESPONSE' });
});

test('nomes preservam Unicode correto e recuperam o mojibake do exemplo', () => {
  const name = '☼bear☼ + 🌻Tyki🌻';
  assert.equal(queueName(Buffer.from(name).toString('latin1')), name);
  assert.equal(queueName('Mulécula + João 🌻'), 'Mulécula + João 🌻');
  assert.equal(queueName('Nome\ncom\tlinhas'), 'Nome com linhas');
});

test('contadores inválidos são recusados e métricas ausentes permanecem desconhecidas', () => {
  for (const patch of [{ games: null }, { games: -1 }, { wins: 101 }, { brawlhalla_id: 0 }, { rank: null }]) assert.throws(() => normalizeQueueRow(row(patch), '1v1'), { queueCode: 'RESPONSE' });
  const result = normalizeQueueRow(row({ rating: null, peak_rating: null, wins: null }), '1v1');
  assert.equal(result.rating, null); assert.equal(result.peak, null); assert.equal(result.wins, null);
});

test('primeira consulta só cria base; abrir o comando não gera chamadas à API', async () => {
  const f = fixture();
  assert.equal((await f.service.snapshot()).status, 'warming');
  assert.equal(f.calls, 0);
  await f.service.poll();
  const view = await f.service.snapshot();
  assert.equal(f.calls, QUEUE_PAGES * 2); assert.equal(view.status, 'warming'); assert.deepEqual(view.entries, []);
  await f.service.snapshot('2v2'); assert.equal(f.calls, QUEUE_PAGES * 2);
  assert.ok(validQueueState(f.state));
});

test('somente aumento de partidas confirma atividade; mudanças de ELO e posição não bastam', async () => {
  const f = fixture(); await f.service.poll(); f.advance();
  Object.assign(f.data['1v1'][0], { rating: 2470, rank: 80 });
  f.data['2v2'][0].games++;
  await f.service.poll();
  assert.equal((await f.service.snapshot()).status, 'ready'); assert.deepEqual((await f.service.snapshot()).entries, []);
  const doubles = await f.service.snapshot('2v2'); assert.equal(doubles.entries.length, 1); assert.equal(doubles.players, 2);
  f.advance(); f.data['1v1'][0].games++; f.data['1v1'][0].rank = 76;
  await f.service.poll();
  const player = (await f.service.snapshot()).entries[0];
  assert.equal(player.rankBefore, 80); assert.equal(player.rank, 76); assert.equal(player.lastActivityAt, f.now());
});

test('atividade expira mesmo com leituras repetidas do mesmo jogador no ranking', async () => {
  const f = fixture(); await f.service.poll(); f.advance(); f.data['1v1'][0].games++; await f.service.poll();
  f.advance(QUEUE_ACTIVE_MS - 1); await f.service.poll(); assert.equal((await f.service.snapshot()).entries.length, 1);
  f.advance(1); await f.service.poll(); assert.equal((await f.service.snapshot()).entries.length, 0);
});

test('sessão preserva início e posição inicial enquanto novas partidas continuam', async () => {
  const f = fixture(); await f.service.poll(); f.advance(); f.data['1v1'][0].games++; await f.service.poll();
  const first = (await f.service.snapshot()).entries[0];
  f.advance(); Object.assign(f.data['1v1'][0], { games: 102, rank: 70 }); await f.service.poll();
  const next = (await f.service.snapshot()).entries[0];
  assert.equal(next.since, first.since); assert.equal(next.rankBefore, 86); assert.notEqual(next.lastActivityAt, first.lastActivityAt);
});

test('falha em uma página preserva o retrato inteiro dessa modalidade e permite atualizar a outra', async () => {
  const f = fixture(); await f.service.poll(); f.advance(); f.data['1v1'][0].games++; await f.service.poll();
  const old = await f.service.snapshot(); f.advance(); f.errors.add('1v1:10'); f.data['2v2'][0].games++;
  await f.service.poll();
  const stale = await f.service.snapshot();
  assert.equal(stale.status, 'stale'); assert.equal(stale.updatedAt, old.updatedAt); assert.equal(stale.entries[0].games, old.entries[0].games);
  assert.equal((await f.service.snapshot('2v2')).entries.length, 1);
});

test('falha desde a primeira consulta mostra indisponibilidade, sem confirmar fila vazia', async () => {
  const f = fixture(); f.errors.add('1v1:1'); await f.service.poll();
  assert.equal((await f.service.snapshot()).status, 'unavailable');
  f.advance(); f.errors.clear(); await f.service.poll(); assert.equal((await f.service.snapshot()).status, 'warming');
});

test('reinício reaproveita base recente, mas uma lacuna longa exige nova comparação', async () => {
  const f = fixture(); await f.service.poll(); f.advance();
  const restarted = createRankedQueueService({ store: f.store, fetchPage: f.fetchPage, now: f.now });
  f.data['1v1'][0].games++; await restarted.poll(); assert.equal((await restarted.snapshot()).entries.length, 1);
  f.advance(QUEUE_ACTIVE_MS + 1); f.data['1v1'][0].games += 10; await restarted.poll();
  const view = await restarted.snapshot(); assert.equal(view.status, 'warming'); assert.equal(view.entries.length, 0);
});

test('reset de temporada e jogador novo não são tratados como partidas recém-jogadas', async () => {
  const f = fixture(); await f.service.poll(); f.advance(); f.data['1v1'][0].games++; await f.service.poll();
  f.advance(); f.data['1v1'] = [row({ games: 0, wins: 0 }), row({ brawlhalla_id: 77 })]; await f.service.poll();
  assert.equal((await f.service.snapshot()).entries.length, 0);
});

test('jogador fora da cobertura sai da lista; múltiplas duplas contam IDs únicos', async () => {
  const f = fixture(); f.data['2v2'].push(team(10, 30)); await f.service.poll(); f.advance();
  f.data['2v2'].forEach(entry => entry.games++); await f.service.poll();
  assert.equal((await f.service.snapshot('2v2')).players, 3);
  f.advance(); f.data['2v2'] = []; await f.service.poll(); assert.equal((await f.service.snapshot('2v2')).entries.length, 0);
});

test('ciclos concorrentes compartilham o trabalho e aguardam todas as páginas', async () => {
  const f = fixture(); let release;
  const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  const service = createRankedQueueService({ store: f.store, now: f.now, fetchPage: async (...args) => { calls++; await gate; return f.fetchPage(...args); } });
  const one = service.poll(), two = service.poll();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 20);
  release(); await Promise.all([one, two]); assert.equal(calls, 20);
});

test('falha ao gravar não publica em memória um retrato que não foi persistido', async () => {
  const f = fixture(); await f.service.poll(); f.advance(); f.data['1v1'][0].games++;
  f.store.write = async () => { throw new Error('disk-full'); };
  await assert.rejects(f.service.poll(), /disk-full/);
  assert.equal((await f.service.snapshot()).status, 'warming'); assert.equal((await f.service.snapshot()).entries.length, 0);
});

test('armazenamento é atômico, privado e não sobrescreve JSON inválido ao carregar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tgg-ranked-queue-'));
  try {
    const path = join(directory, 'ranked-queue.json'), store = createRankedQueueStore(path);
    assert.deepEqual(await store.read(), emptyQueueState()); await store.write(emptyQueueState());
    assert.deepEqual(await store.read(), emptyQueueState());
    assert.deepEqual(await readdir(directory), ['ranked-queue.json']);
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    await writeFile(path, '{broken'); await assert.rejects(store.read(), { queueCode: 'STORAGE' });
    assert.equal(await readFile(path, 'utf8'), '{broken');
    await writeFile(path, JSON.stringify({ ...emptyQueueState(), modes: 1 }));
    await assert.rejects(store.read(), { queueCode: 'STORAGE' });
    assert.equal(validQueueState({ ...emptyQueueState(), modes: [] }), false);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  }
});
