import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrawlhallaService } from '../src/services/brawlhallaService.js';

const down = async () => { throw Object.assign(new Error('offline'), { status: 502, apiForaDoAr: true }); };
const older = { clan_id: 3, clan_name: 'Guilda antiga', clan_create_date: 1000, clan_xp: 900000, clan_lifetime_xp: 950000, clan: [{ brawlhalla_id: 10, name: 'Membro antigo', rank: 'Member', xp: 80000, join_date: 1000 }] };
const current = { guild_id: 3, name: 'Guilda atual', create_date: 1000, member_count: 1, xp: 2000, legacy_xp: 500, guild_points: 42 };
const primaryMembers = { guild_id: 3, guild_members: [{ brawlhalla_id: 10, name: null, rank: 'Officer', guild_points: 7 }] };
const make = options => createBrawlhallaService({ ownGuildId: '3', legacyGuild: async () => older, guild: async () => current, members: async () => primaryMembers, playerStats: async () => ({ brawlhalla_id: 100, games: 50, ranked: { games: 20 } }), playerGuild: async id => ({ brawlhalla_id: id, guild_id: 3, personal_points: 7 }), ...options });

test('guilda mantém um formato único tanto com v1 saudável quanto com fallback antigo', async () => {
  const healthy = await make({}).getGuild('3');
  const fallback = await make({ guild: down }).getGuild('3', { requireGuildPoints: false });
  assert.deepEqual(Object.keys(healthy).sort(), Object.keys(fallback).sort());
  assert.equal(healthy.guild_points, 42);
  assert.equal(healthy.xp_total, 2500);
  assert.equal(fallback.guild_points, null);
  assert.equal(fallback.xp_total, 950000);
  assert.equal(fallback.member_count, 1);
  assert.equal(fallback.availability.guildPoints, false);
  assert.equal(fallback.sources.guildPoints, null);
});

test('rotinas que exigem GP não recebem XP como substituto quando a v1 cai', async () => {
  await assert.rejects(make({ guild: down }).getGuild('3'), e => e.status === 502);
  await assert.rejects(make({ members: down }).getMembers('3'), e => e.status === 502);
  const result = await make({ members: down }).getMembers('3', { requireGuildPoints: false });
  assert.equal(result.guild_members[0].xp, 80000);
  assert.equal(result.guild_members[0].guild_points, null);
});

test('v0 completa metadados ausentes, preservando GP zero real da v1', async () => {
  const result = await make({ guild: async () => ({ guild_id: 3, guild_points: 0 }) }).getGuild('3');
  assert.equal(result.name, 'Guilda antiga');
  assert.equal(result.member_count, 1);
  assert.equal(result.guild_points, 0);
  assert.equal(result.apiSource, 'mixed');
  assert.equal(result.sources.guildPoints, 'v1');
});

test('indisponibilidade da antiga não descarta dados válidos da v1', async () => {
  const service = make({ legacyGuild: down });
  assert.equal((await service.getGuild('3')).guild_points, 42);
  assert.equal((await service.getMembers('3')).guild_members[0].guild_points, 7);
});

test('membros são associados por ID; nomes iguais não transferem cargo, XP ou pontos', async () => {
  const service = make({
    members: async () => ({ guild_id: 3, guild_members: [{ brawlhalla_id: 10, guild_points: 0 }, { brawlhalla_id: 11, name: 'Mesmo nome', guild_points: 9 }] }),
    legacyGuild: async () => ({ ...older, clan: [...older.clan, { brawlhalla_id: 12, name: 'Mesmo nome', rank: 'Leader', xp: 999999 }] }),
  });
  const result = await service.getMembers('3');
  assert.equal(result.guild_members.length, 2);
  assert.equal(result.guild_members[0].name, 'Membro antigo');
  assert.equal(result.guild_members[0].guild_points, 0);
  assert.equal(result.guild_members[1].rank, null);
  assert.equal(result.guild_members[1].xp, null);
  assert.equal(result.guild_members[1].guild_points, 9);
});

test('lista v1 vazia que contradiz a lista antiga não é tratada como saída de todos', async () => {
  const service = make({ members: async () => ({ guild_id: 3, guild_members: [] }) });
  await assert.rejects(service.getMembers('3'), e => e.guildPointsUnavailable);
  const display = await service.getMembers('3', { requireGuildPoints: false });
  assert.equal(display.guild_members.length, 1);
  assert.equal(display.guild_members[0].guild_points, null);
});

test('membros sem qualquer GP válido não liberam uma classificação artificial de zeros', async () => {
  const service = make({ members: async () => ({ guild_id: 3, guild_members: [{ brawlhalla_id: 10, guild_points: null }] }) });
  await assert.rejects(service.getMembers('3'), e => e.guildPointsUnavailable);
});

test('dados de outra guilda não são mesclados com o ID solicitado', async () => {
  const service = make({ guild: async () => ({ ...current, guild_id: 4 }), legacyGuild: async () => ({ ...older, clan_id: 4 }) });
  await assert.rejects(service.getGuild('3'));
  await assert.rejects(service.getGuild('3', { requireGuildPoints: false }));
});

test('consulta individual com falha recupera GP da rota em lote da mesma conta', async () => {
  const result = await make({ playerGuild: down }).getPlayerGuild('10');
  assert.equal(result.personal_points, 7);
  assert.equal(result.brawlhalla_id, '10');
  assert.equal(result.apiSource, 'v1-batch');
  const direct = await make({}).getPlayerGuild('10');
  assert.deepEqual(Object.keys(result).sort(), Object.keys(direct).sort());
});

test('cache que pertence a outra guilda não contamina o resultado normalizado', () => {
  const service = make({ cachedGuild: () => ({ ...current, guild_id: 4 }) });
  assert.equal(service.getCachedGuild('3'), null);
});

test('resposta individual de outra conta não fornece os pontos do usuário', async () => {
  const result = await make({ playerGuild: async () => ({ brawlhalla_id: 999, personal_points: 9999 }) }).getPlayerGuild('10');
  assert.equal(result.personal_points, 7);
});

test('perfil mantém contadores da principal separados dos pontos da conta registrada na guilda', async () => {
  const result = await make({}).getPlayerProfile('10');
  assert.equal(result.brawlhalla_id, 100);
  assert.equal(result.guildAccountId, '10');
  assert.equal(result.games, 50);
  assert.equal(result.guildPoints, 7);
  assert.equal(result.sources.stats, 'v0');
});

test('pontos opcionais travados não prendem a resposta com estatísticas disponíveis', async () => {
  const result = await make({ optionalTimeoutMs: 5, playerGuild: () => new Promise(() => {}) }).getPlayerProfile('10');
  assert.equal(result.games, 50);
  assert.equal(result.guildPoints, null);
  assert.equal(result.availability.guildPoints, false);
});

test('um resultado obrigatório de estatísticas indisponível continua sendo erro', async () => {
  await assert.rejects(make({ playerStats: down }).getPlayerProfile('10'), e => e.status === 502);
});
