import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFetch as createPacedApiFetch } from '../src/services/brawlhallaHttp.js';

const createApiFetch = options => createPacedApiFetch({ v0MinIntervalMs: 0, ...options });

const logger = { warn() {} };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('chamadas v0 são espaçadas para evitar a rejeição por rajada; v1 continua independente', async () => {
  let time = 1000;
  const starts = [], waits = [];
  const request = createPacedApiFetch({ now: () => time, wait: async ms => { waits.push(ms); time += ms; }, logger, fetchImpl: async () => { starts.push(time); return json({ ok: true }); } });
  for (let i = 0; i < 3; i++) await request(`https://api.brawlhalla.com/player/${i}/stats`);
  await request('https://api.brawlhalla.com/v1/guild/stats?guild_id=3');
  assert.deepEqual(starts, [1000, 1500, 2000, 2000]);
  assert.deepEqual(waits, [500, 500]);
});

test('pedidos concorrentes não se acumulam em rajada mesmo quando o relógio avança além da espera', async () => {
  let time = 1000;
  const starts = [];
  const request = createPacedApiFetch({ now: () => time, wait: async ms => { time += ms + 1000; }, logger, fetchImpl: async () => { starts.push(time); return json({ ok: true }); } });
  await Promise.all([1, 2, 3, 4].map(id => request(`https://api.brawlhalla.com/player/${id}/stats`)));
  assert.equal(starts.length, 4);
  assert.ok(starts.slice(1).every((time, index) => time - starts[index] >= 500));
});

test('monitor em segundo plano preserva 60 consultas v0 para os comandos e não espera a janela de cota', async () => {
  let calls = 0, time = 1000;
  const request = createApiFetch({ logger, now: () => time, wait: async () => assert.fail('monitor não deve aguardar a janela de 15 minutos'), fetchImpl: async () => { calls++; return json({ ok: true }); } });
  for (let i = 0; i < 120; i++) await request(`https://api.brawlhalla.com/player/${i}/stats`);
  const ranking = 'https://api.brawlhalla.com/rankings/1v1/brz/1';
  await assert.rejects(request(ranking, { background: true }), error => error.apiQuotaDeferred && error.status === 429);
  assert.equal(calls, 120);
  assert.deepEqual(await request(ranking), { ok: true }); assert.equal(calls, 121);
  time += 15 * 60_000;
  assert.deepEqual(await request(ranking, { background: true }), { ok: true }); assert.equal(calls, 122);
});

test('deferir ranking em segundo plano não interfere com a cota v1', async () => {
  let calls = 0;
  const request = createApiFetch({ logger, fetchImpl: async () => { calls++; return json({ ok: true }); } });
  for (let i = 0; i < 120; i++) await request(`https://api.brawlhalla.com/player/${i}/stats`);
  assert.deepEqual(await request('https://api.brawlhalla.com/v1/guild/stats?guild_id=3', { background: true }), { ok: true });
  assert.equal(calls, 121);
});

test('uma falha transitória é repetida e uma resposta boa é preservada', async () => {
  let calls = 0;
  const request = createApiFetch({ logger, wait: async () => {}, fetchImpl: async () => ++calls === 1 ? json({}, 502) : json({ guild_points: 10 }) });
  assert.deepEqual(await request('https://api.brawlhalla.com/v1/guild/stats?guild_id=3'), { guild_points: 10 });
  assert.equal(calls, 2);
});

test('queda persistente da v1 não bloqueia v0 e a v1 é testada novamente após a pausa', async () => {
  let time = 1000;
  let healthy = false;
  let calls = 0;
  const request = createApiFetch({ logger, now: () => time, wait: async () => {}, fetchImpl: async input => {
    calls++;
    return String(input).includes('/v1/') && !healthy ? json({}, 502) : json({ ok: true });
  } });
  const route = 'https://api.brawlhalla.com/v1/guild/members?guild_id=3';
  await assert.rejects(request(route), e => e.apiForaDoAr && e.status === 502 && e.apiVersion === 'v1');
  assert.equal(calls, 2);
  await assert.rejects(request(route), e => e.apiForaDoAr);
  assert.equal(calls, 2);
  assert.deepEqual(await request('https://api.brawlhalla.com/clan/3?api_key=offline'), { ok: true });
  healthy = true;
  time += 30_001;
  assert.deepEqual(await request(route), { ok: true });
});

test('timeout encerra requisição travada', async () => {
  const request = createApiFetch({ logger, timeoutMs: 10, attempts: 1, fetchImpl: async (_url, options) => {
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await assert.rejects(request('https://api.brawlhalla.com/v1/guild/stats?guild_id=3'), e => e.apiForaDoAr);
});

test('uma rota v1 fora do ar não bloqueia outra rota v1 saudável', async () => {
  const request = createApiFetch({ logger, attempts: 1, fetchImpl: async url => url.pathname === '/v1/player/guild' ? json({}, 502) : json({ guild_members: [] }) });
  await assert.rejects(request('https://api.brawlhalla.com/v1/player/guild?brawlhalla_id=1'), e => e.status === 502);
  assert.deepEqual(await request('https://api.brawlhalla.com/v1/guild/members?guild_id=3'), { guild_members: [] });
});

test('timeout também cobre o corpo da resposta', async () => {
  const request = createApiFetch({ logger, timeoutMs: 10, attempts: 1, fetchImpl: async (_url, options) => ({
    status: 200, ok: true,
    json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  }) });
  await assert.rejects(request('https://api.brawlhalla.com/v1/guild/stats?guild_id=3'), e => e.apiForaDoAr);
});

test('404 é preservado sem repetição e não abre pausa da v1', async () => {
  let calls = 0;
  const request = createApiFetch({ logger, fetchImpl: async () => ++calls === 1 ? json({}, 404) : json({ ok: true }) });
  await assert.rejects(request('https://api.brawlhalla.com/v1/player/stats?brawlhalla_id=1'), e => e.status === 404 && !e.apiForaDoAr);
  await request('https://api.brawlhalla.com/v1/player/stats?brawlhalla_id=2');
  assert.equal(calls, 2);
});

test('logs e erros não expõem chave nem corpo HTML', async () => {
  const logs = [];
  const request = createApiFetch({ logger: { warn: value => logs.push(value) }, attempts: 1, fetchImpl: async () => new Response('<html>secret-key</html>', { status: 502 }) });
  let error;
  try { await request('https://api.brawlhalla.com/player/1/stats?api_key=secret-key'); } catch (e) { error = e; }
  assert.ok(error.apiForaDoAr);
  assert.doesNotMatch(JSON.stringify(logs) + error.message, /secret-key|<html>|api_key/);
});

test('chamadas idênticas em andamento compartilham uma requisição', async () => {
  let finish;
  let calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  const request = createApiFetch({ logger, fetchImpl: async () => { calls++; await gate; return json({ ok: true }); } });
  const url = 'https://api.brawlhalla.com/v1/guild/stats?guild_id=3';
  const one = request(url);
  const two = request(url);
  finish();
  await Promise.all([one, two]);
  assert.equal(calls, 1);
});

test('comandos e crons compartilham o teto de simultaneidade', async () => {
  let active = 0;
  let peak = 0;
  const request = createApiFetch({ logger, maxConcurrent: 2, fetchImpl: async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return json({ ok: true });
  } });
  await Promise.all(Array.from({ length: 8 }, (_, i) => request(`https://api.brawlhalla.com/v1/player/stats?brawlhalla_id=${i}`)));
  assert.equal(peak, 2);
});

test('a cota da v0 espera a próxima janela e conta as tentativas', async () => {
  let time = 1;
  const waits = [];
  const request = createApiFetch({ logger, now: () => time, wait: async ms => { waits.push(ms); time += ms; }, fetchImpl: async () => json({ ok: true }) });
  for (let i = 0; i < 181; i++) await request(`https://api.brawlhalla.com/player/${i}/stats?api_key=offline`);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 15 * 60_000);
});
