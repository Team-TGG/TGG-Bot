import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { adminCommands } from '../src/slash/builders/admin.js';

test('/ia é público e os comandos de moderação continuam restritos', () => {
  const commands = adminCommands.map(command => command.toJSON());
  assert.ok(commands.find(command => command.name === 'ia'));
  assert.equal(commands.find(command => command.name === 'ia').default_member_permissions, null);
  assert.equal(commands.find(command => command.name === 'ban').default_member_permissions, PermissionFlagsBits.BanMembers.toString());
  assert.equal(commands.find(command => command.name === 'warn').default_member_permissions, PermissionFlagsBits.ModerateMembers.toString());
});

test('.ia e /ia atendem usuário comum; conversa livre não consulta banco nem API do jogo', async () => {
  const previousCwd = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), 'tgg-ia-offline-'));
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const timers = [];
  const requests = [];
  let online = false;
  Object.assign(process.env, { IA_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen3.5:4b', OLLAMA_BASE_URL: 'http://127.0.0.1:11435', SUPABASE_URL: 'https://review.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline', GEMINI_API_KEY: '', DISCORD_TOKEN: '', BOT_ADMIN_USER_IDS: '100000000000000001', DOTENV_CONFIG_PATH: join(temporary, 'absent.env') });
  globalThis.setInterval = (...args) => { const timer = originalSetInterval(...args); timers.push(timer); return timer; };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    requests.push(url);
    if (url.origin === 'http://127.0.0.1:11435') {
      if (!online) throw new Error('ECONNREFUSED');
      const body = JSON.parse(options.body);
      if (!body.tools) assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
      return new Response(JSON.stringify({ message: body.tools ? { tool_calls: [{ function: { name: 'conversa_livre', arguments: {} } }] } : { content: 'Ora, um alô! Que a luz acompanhe sua conversa.' } }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.hostname === 'api.brawlhalla.com' && url.pathname === '/legend/all') return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    assert.fail(`Nenhuma outra rede deveria ser usada: ${url.hostname}`);
  };
  process.chdir(temporary);
  try {
    const { handleIa } = await import('../src/admin.js');
    const replies = [];
    const edits = [];
    const sent = { edit: async body => { edits.push(body); return sent; } };
    const message = { author: { id: '100000000000000002', tag: 'membro-comum' }, reply: async body => { replies.push(body); return sent; } };
    await handleIa(message, ['quem', 'são', 'os', 'MVPs?']);
    assert.equal(replies.length, 1);
    assert.equal(edits.length, 1);
    const embed = edits[0].embeds[0].toJSON();
    assert.match(embed.title, /Lady Vera está em repouso/);
    assert.match(embed.description, /ativada manualmente/);
    assert.equal(requests.some(url => url.hostname.includes('googleapis')), false);
    assert.equal(requests.some(url => url.pathname.includes('/guild/')), false);
    online = true;
    replies.length = 0;
    edits.length = 0;
    requests.length = 0;
    await handleIa(message, ['alô']);
    assert.equal(replies.length, 1);
    assert.equal(edits.length, 1);
    assert.match(edits[0].embeds[0].toJSON().description, /um alô/);
    assert.ok(requests.every(url => url.origin === 'http://127.0.0.1:11435'));
    replies.length = 0;
    edits.length = 0;
    requests.length = 0;
    await handleIa({ ...message, interaction: { options: { getString: name => { assert.equal(name, 'pergunta'); return 'alô'; } } } }, []);
    assert.equal(replies.length, 1);
    assert.equal(edits.length, 1);
    assert.match(edits[0].embeds[0].toJSON().description, /um alô/);
    assert.ok(requests.every(url => url.origin === 'http://127.0.0.1:11435'));
  } finally {
    for (const timer of timers) clearInterval(timer);
    globalThis.setInterval = originalSetInterval;
    globalThis.fetch = originalFetch;
    process.chdir(previousCwd);
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    rmSync(temporary, { recursive: true, force: true });
  }
});
