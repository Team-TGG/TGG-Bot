import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

test('.ia desligada informa ativação manual e não usa Gemini ou executa consultas da guilda', async () => {
  const previousCwd = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), 'tgg-ia-offline-'));
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const timers = [];
  const requests = [];
  Object.assign(process.env, { IA_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen3.5:4b', OLLAMA_BASE_URL: 'http://127.0.0.1:11435', SUPABASE_URL: 'https://review.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline', GEMINI_API_KEY: '', DISCORD_TOKEN: '', BOT_ADMIN_USER_IDS: '100000000000000001', DOTENV_CONFIG_PATH: join(temporary, 'absent.env') });
  globalThis.setInterval = (...args) => { const timer = originalSetInterval(...args); timers.push(timer); return timer; };
  globalThis.fetch = async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.origin === 'http://127.0.0.1:11435') throw new Error('ECONNREFUSED');
    if (url.hostname === 'api.brawlhalla.com' && url.pathname === '/legend/all') return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    assert.fail(`Nenhuma outra rede deveria ser usada: ${url.hostname}`);
  };
  process.chdir(temporary);
  try {
    const { handleIa } = await import('../src/admin.js');
    const replies = [];
    const edits = [];
    const sent = { edit: async body => { edits.push(body); return sent; } };
    await handleIa({ author: { id: '100000000000000001' }, reply: async body => { replies.push(body); return sent; } }, ['quem', 'são', 'os', 'MVPs?']);
    assert.equal(replies.length, 1);
    assert.equal(edits.length, 1);
    const embed = edits[0].embeds[0].toJSON();
    assert.match(embed.title, /Lady Vera está em repouso/);
    assert.match(embed.description, /ativada manualmente/);
    assert.equal(requests.some(url => url.hostname.includes('googleapis')), false);
    assert.equal(requests.some(url => url.pathname.includes('/guild/')), false);
  } finally {
    for (const timer of timers) clearInterval(timer);
    globalThis.setInterval = originalSetInterval;
    globalThis.fetch = originalFetch;
    process.chdir(previousCwd);
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    rmSync(temporary, { recursive: true, force: true });
  }
});
