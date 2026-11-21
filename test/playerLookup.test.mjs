import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerLookup, normalizePlayerName } from '../src/services/playerLookup.js';

function setup(overrides = {}) {
  const requests = [];
  const lookup = createPlayerLookup({
    getMembers: async () => [{ brawlhalla_id: 42, name: 'TGG | Trínca-Ferro' }],
    searchPlayers: async name => { requests.push(['search', name]); return []; },
    getUser: async id => { requests.push(['user', id]); return { brawlhalla_id: 84 }; },
    getStats: async id => { requests.push(['stats', id]); return { brawlhalla_id: Number(id), name: `Conta ${id}` }; },
    ...overrides,
  });
  return { lookup, requests };
}

test('nome ignora acentos, separadores e letras estilizadas sem depender de caixa', () => {
  assert.equal(normalizePlayerName('𝐓𝐫í𝐧𝐜𝐚—𝐅𝐞𝐫𝐫𝐨'), 'trincaferro');
});

test('perfil por apelido encontra a conta da guilda sem buscar outro jogador global', async () => {
  const { lookup, requests } = setup();
  const result = await lookup({ nome: 'trinca ferro' }, { discordId: 'autor' });
  assert.equal(result.status, 'found');
  assert.equal(result.stats.brawlhalla_id, 42);
  assert.deepEqual(requests, [['stats', '42']]);
  assert.equal(result.self, false);
});

test('nome completo exato tem preferência sobre trechos semelhantes', async () => {
  const { lookup, requests } = setup({ getMembers: async () => [{ brawlhalla_id: 42, name: 'Trinca Ferro' }, { brawlhalla_id: 43, name: 'Trinca Ferro 2' }] });
  assert.equal((await lookup({ nome: 'trinca ferro' })).status, 'found');
  assert.deepEqual(requests, [['stats', '42']]);
});

test('nome ambíguo lista candidatos sem consultar estatísticas de uma conta arbitrária', async () => {
  const { lookup, requests } = setup({ getMembers: async () => [{ brawlhalla_id: 42, name: 'Trinca Ferro' }, { brawlhalla_id: 43, name: 'Trinca Ferro' }] });
  const result = await lookup({ nome: 'Trinca Ferro' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(requests, []);
});

test('busca externa funciona mesmo quando a lista da guilda está indisponível', async () => {
  const { lookup, requests } = setup({ getMembers: async () => { throw new Error('indisponível'); }, searchPlayers: async () => [{ brawlhalla_id: 99, name: 'Outro Jogador' }] });
  const result = await lookup({ nome: 'Outro Jogador' });
  assert.equal(result.status, 'found');
  assert.deepEqual(requests, [['stats', '99']]);
  assert.equal(result.source, 'busca pública do ranking 1v1');
});

test('resposta do ranking é filtrada por nome e IDs repetidos não geram ambiguidade', async () => {
  const { lookup, requests } = setup({ searchPlayers: async () => [{ brawlhalla_id: 99, name: 'Fora' }, { brawlhalla_id: 99, name: 'Fora' }, { brawlhalla_id: 77, name: 'Outra pessoa' }] });
  assert.equal((await lookup({ nome: 'Fora' })).status, 'found');
  assert.deepEqual(requests, [['stats', '99']]);
});

test('perfil próprio usa o cadastro do autor e menção usa o alvo, sem confundir contas', async () => {
  const { lookup, requests } = setup();
  assert.equal((await lookup({ nome: 'eu' }, { discordId: 'autor' })).self, true);
  assert.equal((await lookup({}, { discordId: 'autor', membroDiscordId: 'alvo' })).self, false);
  assert.deepEqual(requests, [['user', 'autor'], ['stats', '84'], ['user', 'alvo'], ['stats', '84']]);
});

test('página pública cheia pede ID mesmo com um único nome exato na primeira página', async () => {
  const { lookup, requests } = setup({ searchPlayers: async () => Array.from({ length: 50 }, (_, index) => ({ brawlhalla_id: index + 100, name: index === 0 ? 'Fora' : `Fora ${index}` })) });
  const result = await lookup({ nome: 'Fora' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.incomplete, true);
  assert.deepEqual(requests, []);
});

test('sem cadastro a busca própria pede nome ou ID sem consultar jogador aleatório', async () => {
  const { lookup, requests } = setup({ getUser: async () => null });
  assert.equal((await lookup({}, { discordId: 'autor' })).status, 'unregistered');
  assert.deepEqual(requests, []);
});

test('ID explícito consulta essa conta e evita busca por nome e cadastro', async () => {
  const { lookup, requests } = setup();
  assert.equal((await lookup({ brawlhalla_id: '00042' }, { discordId: 'autor' })).stats.brawlhalla_id, 42);
  assert.deepEqual(requests, [['stats', '42']]);
});

test('ID do Discord, URL e apelido curto não provocam chamadas externas', async () => {
  const { lookup, requests } = setup();
  for (const brawlhalla_id of ['321055835683946497', 'https://example.com', '-1', '']) assert.equal((await lookup({ nome: 'qualquer', brawlhalla_id })).status, 'invalid-id');
  assert.equal((await lookup({ nome: 'x' })).status, 'invalid-name');
  assert.deepEqual(requests, []);
});

test('jogador não encontrado e API indisponível são resultados distintos', async () => {
  const { lookup } = setup();
  assert.equal((await lookup({ nome: 'Não existe' })).status, 'not-found');
  const missing = setup({ getStats: async () => { throw Object.assign(new Error('404'), { status: 404 }); } });
  assert.equal((await missing.lookup({ brawlhalla_id: '42' })).status, 'not-found');
  const unavailable = setup({ getStats: async () => { throw Object.assign(new Error('502'), { apiForaDoAr: true }); } });
  await assert.rejects(unavailable.lookup({ brawlhalla_id: '42' }), { apiForaDoAr: true });
});

test('resposta vazia ou de outra conta é rejeitada em vez de atribuir dados incorretos', async () => {
  for (const stats of [{}, { brawlhalla_id: 99, name: 'Outra conta' }]) {
    const { lookup } = setup({ getStats: async () => stats });
    await assert.rejects(lookup({ brawlhalla_id: '42' }), { apiForaDoAr: true });
  }
});
