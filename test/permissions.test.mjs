import test from 'node:test';
import assert from 'node:assert/strict';

const adminId = '100000000000000001';
const otherId = '100000000000000002';
Object.assign(process.env, {
  SUPABASE_URL: 'https://review.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline',
  BOT_ADMIN_USER_IDS: `${adminId}, 100000000000000003\ninvalid`,
});
let dbRole = 'recruit';
let dbActive = true;
let dbDown = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(input);
  assert.equal(url.hostname, 'review.invalid', 'nenhuma rede externa é permitida');
  if (dbDown) return new Response(JSON.stringify({ code: 'offline' }), { status: 503 });
  return new Response(JSON.stringify({ discord_id: otherId, role: dbRole, active: dbActive }), { headers: { 'Content-Type': 'application/json' } });
};
const { BOT_ADMIN_USER_IDS, STAFF_ROLE_IDS } = await import('../config/index.js');
const { isAdmin, isLeader, adminOnly, getMemberLevel, hasPermission } = await import('../utils/permissions.js');
const member = (id, ...roles) => ({ id, roles: { cache: new Map(roles.map(roleId => [roleId, { id: roleId }])) } });

test.after(() => { globalThis.fetch = originalFetch; });

test('lista de admins aceita IDs explícitos e ignora entradas inválidas', () => {
  assert.deepEqual([...BOT_ADMIN_USER_IDS], [adminId, '100000000000000003']);
  assert.equal(BOT_ADMIN_USER_IDS.has('invalid'), false);
});

test('admin configurado sem cargo passa nas duas checagens até Administrator', async () => {
  assert.equal(await isAdmin(adminId), true);
  const account = member(adminId);
  assert.equal(getMemberLevel(account), 4);
  for (const level of [1, 2, 3, 4]) assert.equal(hasPermission(account, level), true);
  for (const level of [5, 6]) assert.equal(hasPermission(account, level), false);
  assert.equal(isLeader(adminId), false);
});

test('acesso explícito continua disponível se o cadastro estiver indisponível', async () => {
  dbDown = true;
  try { assert.equal(await isAdmin(adminId), true); }
  finally { dbDown = false; }
});

test('usuário fora da lista não recebe nível de staff ou admin automaticamente', async () => {
  assert.equal(getMemberLevel(member(otherId)), 0);
  assert.equal(hasPermission(member(otherId), 1), false);
  assert.equal(await isAdmin(otherId), false);
  assert.equal(getMemberLevel(undefined), 0);
});

test('hierarquia dos cargos existentes é preservada, inclusive acima do admin configurado', () => {
  for (const [role, level] of [['helper', 1], ['moderator', 2], ['supervisor', 3], ['administrator', 4], ['viceLeader', 5], ['leader', 6]]) {
    assert.equal(getMemberLevel(member(otherId, STAFF_ROLE_IDS[role])), level);
  }
  assert.equal(getMemberLevel(member(adminId, STAFF_ROLE_IDS.leader)), 6);
  assert.equal(getMemberLevel({ user: { id: adminId } }), 4);
});

test('officer e admin do cadastro mantêm a exigência de estar ativo', async () => {
  try {
    dbRole = 'officer';
    assert.equal(await isAdmin(otherId), true);
    assert.equal(getMemberLevel(member(otherId)), 0);
    dbRole = 'admin';
    assert.equal(await isAdmin(otherId), true);
    dbActive = false;
    assert.equal(await isAdmin(otherId), false);
  } finally { dbRole = 'recruit'; dbActive = true; }
});

test('wrapper adminOnly e checagem de cargo aceitam juntos a conta configurada', async () => {
  let executions = 0;
  const handler = adminOnly(async message => {
    assert.equal(hasPermission(message.member, 1), true);
    executions++;
  });
  await handler({ author: { id: adminId }, member: member(adminId), reply: () => assert.fail('admin não deve receber bloqueio') });
  const rejected = [];
  await handler({ author: { id: otherId }, member: member(otherId), reply: async body => rejected.push(body) });
  assert.equal(executions, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].embeds[0].toJSON().title, /Acesso Negado/);
});
