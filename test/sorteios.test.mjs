import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createSorteiosStore } from '../src/sorteiosStore.js';
import { createSorteiosService, parseSorteioDuration, validateSorteioFields } from '../src/services/sorteiosService.js';

const server = '100000000000000001', host = '100000000000000002', channel = '100000000000000003';
const entrants = ['100000000000000004', '100000000000000005', '100000000000000006'];
const fields = { prize: '1 Passe de Batalha', description: 'Entrega pelo organizador.', audience: 'members', winnerCount: 2, durationMs: 60000, color: '#5865F2', image: '', channelId: channel };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function setup(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tgg-giveaway-'));
  t.after(async () => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, 'sorteios.json');
  let time = Date.now(), publications = 0, randomCalls = 0;
  const messages = new Map(), updates = [];
  const store = createSorteiosStore(path);
  const dependencies = { store, now: () => time, random: max => { randomCalls++; return max - 1; }, canEnter: async () => true,
    eligibleEntries: async record => record.entries, validateChannel: async () => {},
    publish: async record => { publications++; const message = { id: '200000000000000001' }; messages.set(record.id, message); return message; },
    findPublished: async record => messages.get(record.id), updateMessage: async record => { updates.push(structuredClone(record)); }, logger: { warn() {} }, ...overrides };
  const make = changes => createSorteiosService({ ...dependencies, ...changes });
  const service = make();
  const create = async (values = {}) => {
    const draft = await service.createDraft({ guildId: server, ownerId: host, channelId: channel });
    await service.updateDraft(draft.id, host, server, { ...fields, ...values });
    return service.publishDraft(draft.id, host, server);
  };
  return { service, store, make, create, path, messages, updates, advance: ms => { time += ms; }, get publications() { return publications; }, get randomCalls() { return randomCalls; } };
}

test('duração aceita dias/horas/minutos e rejeita zero, texto solto, frações e prazos excessivos', () => {
  assert.equal(parseSorteioDuration('2d 3h 30m'), (2 * 1440 + 3 * 60 + 30) * 60000);
  assert.equal(parseSorteioDuration('1 dia 2 horas 15 minutos'), (1440 + 120 + 15) * 60000);
  assert.equal(parseSorteioDuration('45m'), 2700000);
  for (const value of ['0m', '10s', '31d', '-1h', '1.5h', 'amanhã', '1h lixo', '999999999999999999999d']) assert.throws(() => parseSorteioDuration(value), { sorteioCode: 'DURATION' });
});

test('validação exige prêmio, limites de vencedores, público e imagem/cor seguros', () => {
  assert.equal(validateSorteioFields(fields).prize, fields.prize);
  for (const [patch, code] of [[{ prize: '' }, 'TEXT'], [{ description: 'a'.repeat(4001) }, 'TEXT'], [{ title: 't'.repeat(201) }, 'STYLE'], [{ joinLabel: 'b'.repeat(41) }, 'STYLE'], [{ thumbnail: 'http://example.com/x.png' }, 'IMAGE'], [{ roleId: '@everyone' }, 'ROLE'], [{ winnerCount: 0 }, 'WINNERS'], [{ winnerCount: 21 }, 'WINNERS'], [{ audience: 'qualquer' }, 'AUDIENCE'], [{ color: 'red' }, 'COLOR'], [{ image: 'javascript:alert(1)' }, 'IMAGE'], [{ image: 'https://user:password@example.com/a.png' }, 'IMAGE'], [{ channelId: '../x' }, 'CHANNEL']]) {
    assert.throws(() => validateSorteioFields({ ...fields, ...patch }), { sorteioCode: code });
  }
});

test('prévia é privada por dono e servidor e não publica antes da confirmação', async t => {
  const ctx = await setup(t);
  const draft = await ctx.service.createDraft({ guildId: server, ownerId: host, channelId: channel });
  await ctx.service.updateDraft(draft.id, host, server, fields);
  assert.equal(ctx.publications, 0);
  await assert.rejects(ctx.service.getDraft(draft.id, entrants[0], server), { sorteioCode: 'DRAFT' });
  await assert.rejects(ctx.service.getDraft(draft.id, host, 'outro'), { sorteioCode: 'DRAFT' });
  ctx.advance(2 * 3600000 + 1);
  await assert.rejects(ctx.service.publishDraft(draft.id, host, server), { sorteioCode: 'DRAFT' });
  assert.equal(ctx.publications, 0);
});

test('cliques concorrentes em publicar criam uma mensagem e uma inscrição por pessoa', async t => {
  const ctx = await setup(t);
  const draft = await ctx.service.createDraft({ guildId: server, ownerId: host, channelId: channel });
  await ctx.service.updateDraft(draft.id, host, server, fields);
  const published = await Promise.allSettled([ctx.service.publishDraft(draft.id, host, server), ctx.service.publishDraft(draft.id, host, server)]);
  assert.ok(published.some(result => result.status === 'fulfilled'));
  assert.equal(ctx.publications, 1);
  const results = await Promise.all(Array.from({ length: 15 }, () => ctx.service.join(draft.id, server, entrants[0])));
  assert.equal(results.filter(result => result.joined).length, 1);
  assert.deepEqual((await ctx.service.get(draft.id, server)).entries, [entrants[0]]);
  assert.equal((await ctx.service.leave(draft.id, server, entrants[0])).left, true);
  assert.equal((await ctx.service.leave(draft.id, server, entrants[0])).left, false);
});

test('participação confere elegibilidade e rejeita outro servidor e prazo vencido', async t => {
  const ctx = await setup(t, { canEnter: async (_, id) => id === entrants[0] });
  const record = await ctx.create();
  await assert.rejects(ctx.service.join(record.id, server, entrants[1]), { sorteioCode: 'MEMBERS_ONLY' });
  await assert.rejects(ctx.service.join(record.id, 'outro', entrants[0]), { sorteioCode: 'NOT_FOUND' });
  await ctx.service.join(record.id, server, entrants[0]);
  ctx.advance(60000);
  await assert.rejects(ctx.service.join(record.id, server, entrants[1]), { sorteioCode: 'CLOSED' });
  await assert.rejects(ctx.service.leave(record.id, server, entrants[0]), { sorteioCode: 'CLOSED' });
});

test('reinício encerra sorteio vencido e não repete vencedores ao atualizar mensagem', async t => {
  const ctx = await setup(t);
  const record = await ctx.create();
  for (const id of entrants) await ctx.service.join(record.id, server, id);
  ctx.advance(60001);
  const restarted = ctx.make({ store: createSorteiosStore(ctx.path) });
  await Promise.all([restarted.tick(), restarted.tick()]);
  const result = await restarted.get(record.id, server);
  assert.equal(result.status, 'ended');
  assert.equal(result.rounds.length, 1);
  assert.equal(new Set(result.winners).size, 2);
  assert.ok(result.winners.every(id => entrants.includes(id)));
  const choices = ctx.randomCalls;
  await restarted.tick();
  assert.equal(ctx.randomCalls, choices);
  assert.equal((await restarted.get(record.id, server)).rounds.length, 1);
});

test('elegibilidade é refeita no encerramento e dados indisponíveis não viram exclusão silenciosa', async t => {
  let down = true;
  const ctx = await setup(t, { eligibleEntries: async () => { if (down) throw new Error('database-offline'); return [entrants[1]]; } });
  const record = await ctx.create();
  for (const id of entrants) await ctx.service.join(record.id, server, id);
  ctx.advance(60001);
  await ctx.service.tick();
  const pending = await ctx.service.get(record.id, server);
  assert.equal(pending.status, 'drawing'); assert.equal(pending.rounds.length, 0);
  down = false; ctx.advance(60001);
  await ctx.service.tick();
  const result = await ctx.service.get(record.id, server);
  assert.deepEqual(result.winners, [entrants[1]]);
  assert.equal(result.rounds[0].eligibleCount, 1);
});

test('sorteio sem participantes encerra sem inventar vencedores', async t => {
  const ctx = await setup(t);
  const record = await ctx.create();
  const result = await ctx.service.draw(record.id, server, { manual: true });
  assert.equal(result.status, 'ended'); assert.deepEqual(result.winners, []);
  assert.equal(ctx.randomCalls, 0);
});

test('novo sorteio exclui todos os vencedores anteriores e preserva histórico', async t => {
  const ctx = await setup(t);
  const record = await ctx.create({ winnerCount: 1 });
  for (const id of entrants) await ctx.service.join(record.id, server, id);
  const winners = [];
  winners.push(...(await ctx.service.draw(record.id, server, { manual: true })).winners);
  winners.push(...(await ctx.service.draw(record.id, server, { reroll: true })).winners);
  winners.push(...(await ctx.service.draw(record.id, server, { reroll: true })).winners);
  await assert.rejects(ctx.service.draw(record.id, server, { reroll: true }), { sorteioCode: 'NO_ELIGIBLE' });
  const final = await ctx.service.get(record.id, server);
  assert.equal(new Set(winners).size, 3); assert.deepEqual(final.winners, [winners.at(-1)]);
  assert.equal(final.rounds.length, 3);
});

test('cancelamento durante apuração vence a corrida e impede publicação de vencedores', async t => {
  const started = deferred(), release = deferred();
  const ctx = await setup(t, { eligibleEntries: async () => { started.resolve(); await release.promise; return entrants; } });
  const record = await ctx.create();
  for (const id of entrants) await ctx.service.join(record.id, server, id);
  const drawing = ctx.service.draw(record.id, server, { manual: true });
  await started.promise;
  await assert.rejects(ctx.service.join(record.id, server, host), { sorteioCode: 'CLOSED' });
  await ctx.service.cancel(record.id, server); release.resolve();
  const result = await drawing;
  assert.equal(result.status, 'cancelled'); assert.deepEqual(result.rounds, []);
});

test('falha ao editar mensagem mantém o resultado salvo e tenta de novo sem sortear outra vez', async t => {
  let down = true;
  const ctx = await setup(t, { updateMessage: async () => { if (down) throw new Error('discord-offline'); } });
  const record = await ctx.create();
  await ctx.service.join(record.id, server, entrants[0]); ctx.advance(60001);
  await ctx.service.tick();
  const first = await ctx.service.get(record.id, server);
  assert.equal(first.status, 'ended'); assert.equal(first.dirty, true);
  const choices = ctx.randomCalls;
  down = false; ctx.advance(60001); await ctx.service.tick();
  const final = await ctx.service.get(record.id, server);
  assert.equal(final.dirty, false); assert.deepEqual(final.winners, first.winners);
  assert.equal(final.rounds.length, 1); assert.equal(ctx.randomCalls, choices);
});

test('atualizações concorrentes nunca reabrem visualmente um sorteio já encerrado', async t => {
  const started = deferred(), release = deferred(), delivered = [];
  let calls = 0;
  const ctx = await setup(t, { updateMessage: async record => { if (++calls === 1) { started.resolve(); await release.promise; } delivered.push(record.status); } });
  const record = await ctx.create(); await ctx.service.join(record.id, server, entrants[0]);
  const first = ctx.service.sync(record); await started.promise;
  const ended = await ctx.service.draw(record.id, server, { manual: true });
  const last = ctx.service.sync(ended); release.resolve();
  await Promise.all([first, last]);
  assert.equal(delivered.at(-1), 'ended');
  assert.equal((await ctx.service.get(record.id, server)).dirty, false);
});

test('crash após envio recupera a mensagem pendente sem publicar uma cópia', async t => {
  let sent = 0;
  const ctx = await setup(t, { publish: async record => { sent++; ctx.messages.set(record.id, { id: '200000000000000002' }); throw new Error('connection-reset-after-send'); } });
  const draft = await ctx.service.createDraft({ guildId: server, ownerId: host, channelId: channel });
  await ctx.service.updateDraft(draft.id, host, server, fields);
  await assert.rejects(ctx.service.publishDraft(draft.id, host, server));
  const restarted = ctx.make({ store: createSorteiosStore(ctx.path) }); await restarted.tick();
  const recovered = await restarted.get(draft.id, server);
  assert.equal(recovered.status, 'active'); assert.equal(recovered.messageId, '200000000000000002');
  assert.equal(sent, 1);
});

test('arquivo inválido ou falha de escrita não é convertido em um sorteio vazio', async t => {
  const ctx = await setup(t);
  const record = await ctx.create();
  const previous = await readFile(ctx.path, 'utf8');
  const broken = ctx.make({ store: createSorteiosStore(ctx.path, { write: async () => { throw new Error('disk-full'); } }) });
  await assert.rejects(broken.join(record.id, server, entrants[0]), { sorteioCode: 'UNAVAILABLE' });
  assert.equal(await readFile(ctx.path, 'utf8'), previous);
  await writeFile(ctx.path, '{corrompido', 'utf8');
  await assert.rejects(createSorteiosStore(ctx.path).read(), { sorteioCode: 'UNAVAILABLE' });
  assert.equal(await readFile(ctx.path, 'utf8'), '{corrompido');
});
