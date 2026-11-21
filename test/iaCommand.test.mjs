import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { adminCommands } from '../src/slash/builders/admin.js';

test('/ia é público; comandos de moderação mantêm suas permissões', () => {
  const commands = adminCommands.map(command => command.toJSON());
  assert.ok(commands.find(command => command.name === 'ia'));
  assert.equal(commands.find(command => command.name === 'ia').default_member_permissions, null);
  assert.doesNotMatch(commands.find(command => command.name === 'ia').description, /^Staff:/);
  assert.equal(commands.find(command => command.name === 'ban').default_member_permissions, PermissionFlagsBits.BanMembers.toString());
  assert.equal(commands.find(command => command.name === 'warn').default_member_permissions, PermissionFlagsBits.ModerateMembers.toString());
});

test('.ia e /ia atendem membros no canal correto e filtram perguntas, respostas e campos', async () => {
  const previousCwd = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), 'tgg-ia-offline-'));
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const timers = [];
  const requests = [];
  const safetyTexts = [];
  let online = false;
  let blockedDirection = null;
  let unavailableDirection = null;
  let profileMode = false;
  let generatedText = 'Ora, um alô! Que a luz acompanhe sua conversa.';
  const safeCategories = Object.fromEntries(['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'].map(name => [name, false]));
  const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  Object.assign(process.env, { IA_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen3.5:4b', OLLAMA_BASE_URL: 'http://127.0.0.1:11435', SUPABASE_URL: 'https://review.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline', OPENAI_API_KEY: 'offline', GEMINI_API_KEY: '', DISCORD_TOKEN: '', BOT_ADMIN_USER_IDS: '100000000000000001', DOTENV_CONFIG_PATH: join(temporary, 'absent.env') });
  globalThis.setInterval = (...args) => { const timer = originalSetInterval(...args); timers.push(timer); return timer; };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    requests.push(url);
    if (url.origin === 'https://api.openai.com') {
      const body = JSON.parse(options.body);
      if (url.pathname === '/v1/moderations') return json({ results: [{ flagged: false, categories: safeCategories }] });
      assert.equal(body.text.format.name, 'discord_sfw_decision');
      const content = JSON.parse(body.input[0].content);
      safetyTexts.push(content);
      if (content.direction === unavailableDirection) return new Response('erro privado que não pode aparecer', { status: 503 });
      const allowed = content.direction !== blockedDirection;
      return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ allowed, reason: allowed ? 'permitted' : 'harassment_hate' }) }] }] });
    }
    if (url.origin === 'http://127.0.0.1:11435') {
      if (!online) throw new Error('ECONNREFUSED');
      const body = JSON.parse(options.body);
      if (!body.tools && !profileMode) assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
      return json({ message: body.tools ? { tool_calls: [{ function: { name: profileMode ? 'perfil_de_jogador' : 'conversa_livre', arguments: profileMode ? { brawlhalla_id: '42' } : {} } }] } : { content: generatedText } });
    }
    if (url.hostname === 'api.brawlhalla.com' && url.pathname === '/legend/all') return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    if (url.hostname === 'api.brawlhalla.com' && /^\/player\/42\/(stats|ranked)$/.test(url.pathname)) return json({ brawlhalla_id: 42, name: 'perfil_nome_bloqueado', level: 10, games: 100, wins: 50 });
    if (url.hostname === 'review.invalid' && url.pathname.endsWith('/users')) return new Response(JSON.stringify({ discord_id: '100000000000000002', role: 'member', active: true }), { headers: { 'Content-Type': 'application/json' } });
    assert.fail(`Nenhuma outra rede deveria ser usada: ${url.hostname}`);
  };
  process.chdir(temporary);
  try {
    const { handleIa } = await import('../src/admin.js');
    const { STAFF_ROLE_IDS } = await import('../config/index.js');
    const replies = [];
    const edits = [];
    const sent = { edit: async body => { edits.push(body); return sent; } };
    const message = { channelId: '1437416406038872225', author: { id: '100000000000000002', tag: 'membro-comum' }, reply: async body => { replies.push(body); return sent; } };
    const interaction = { options: { getString: name => { assert.equal(name, 'pergunta'); return 'alô'; } } };
    replies.length = 0;
    edits.length = 0;
    requests.length = 0;
    message.member = { id: message.author.id, roles: { cache: new Map([[STAFF_ROLE_IDS.helper, { id: STAFF_ROLE_IDS.helper }]]) } };
    await handleIa(message, ['quem', 'são', 'os', 'MVPs?']);
    assert.equal(replies.length, 1);
    assert.equal(edits.length, 1);
    const embed = edits[0].embeds[0].toJSON();
    assert.match(embed.title, /Lady Vera está em repouso/);
    assert.match(embed.description, /ativada manualmente/);
    assert.equal(requests.some(url => url.hostname.includes('googleapis')), false);
    assert.equal(requests.some(url => url.pathname.includes('/guild/')), false);
    online = true;
    const staffMessages = ['assistant', 'helper', 'moderator'].map(role => ({ ...message, member: { id: message.author.id, roles: { cache: new Map([[STAFF_ROLE_IDS[role], { id: STAFF_ROLE_IDS[role] }]]) } } }));
    staffMessages.unshift({ ...message, member: { id: message.author.id, roles: { cache: new Map() } } });
    staffMessages.push({ ...message, author: { id: '100000000000000001', tag: 'admin-autorizado' }, member: undefined });
    // Membro comum, staff e admin configurado não podem usar a IA em outro canal ou por DM.
    for (const staffMessage of staffMessages) {
      for (const channelId of ['1437504463375175936', undefined]) {
        for (const entry of [{ ...staffMessage, channelId }, { ...staffMessage, channelId, interaction }]) {
          replies.length = 0; edits.length = 0; requests.length = 0;
          await handleIa(entry, ['alô']);
          assert.equal(replies.length, 1);
          assert.equal(edits.length, 0);
          assert.match(replies[0].embeds[0].toJSON().description, /1437416406038872225/);
          assert.equal(requests.length, 0, 'canal errado não pode consultar banco, filtro ou IA');
          if (entry.interaction) assert.equal(replies[0].ephemeral, true);
        }
      }
    }
    for (const staffMessage of staffMessages) {
      for (const entry of [staffMessage, { ...staffMessage, interaction }]) {
        replies.length = 0;
        edits.length = 0;
        requests.length = 0;
        await handleIa(entry, ['alô']);
        assert.equal(replies.length, 1);
        assert.equal(edits.length, 1);
        assert.match(edits[0].embeds[0].toJSON().description, /um alô/);
        assert.ok(requests.every(url => ['http://127.0.0.1:11435', 'https://api.openai.com'].includes(url.origin)));
        assert.equal(requests.filter(url => url.origin === 'http://127.0.0.1:11435').length, 2);
        assert.deepEqual(edits[0].allowedMentions, { parse: [], repliedUser: false });
      }
    }

    // O filtro vale para membro comum e para o admin explicitamente configurado.
    blockedDirection = 'input';
    for (const allowedUser of [staffMessages[0], staffMessages.at(-1)]) {
      for (const entry of [allowedUser, { ...allowedUser, interaction }]) {
        replies.length = 0; edits.length = 0; requests.length = 0;
        await handleIa(entry, ['pedido', 'bloqueado']);
        assert.match(edits[0].embeds[0].toJSON().title, /Conteúdo bloqueado/);
        assert.equal(requests.some(url => url.origin === 'http://127.0.0.1:11435'), false);
        assert.equal(requests.some(url => url.hostname === 'api.brawlhalla.com'), false);
        assert.doesNotMatch(JSON.stringify(edits), /pedido bloqueado/);
      }
    }

    blockedDirection = 'output';
    generatedText = 'resposta_modelo_nao_publicar';
    for (const entry of [staffMessages[0], { ...staffMessages[0], interaction }]) {
      replies.length = 0; edits.length = 0; requests.length = 0;
      await handleIa(entry, ['alô']);
      assert.match(edits[0].embeds[0].toJSON().title, /Resposta bloqueada/);
      assert.doesNotMatch(JSON.stringify(edits), /resposta_modelo_nao_publicar/);
    }

    profileMode = true;
    safetyTexts.length = 0; edits.length = 0;
    await handleIa(staffMessages[0], ['perfil', 'ID', '42']);
    assert.ok(safetyTexts.some(content => content.direction === 'output' && content.text.includes('perfil_nome_bloqueado')));
    assert.match(edits[0].embeds[0].toJSON().title, /Resposta bloqueada/);
    assert.doesNotMatch(JSON.stringify(edits), /perfil_nome_bloqueado|resposta_modelo_nao_publicar/);

    profileMode = false;
    blockedDirection = null;
    for (const direction of ['input', 'output']) {
      unavailableDirection = direction;
      replies.length = 0; edits.length = 0; requests.length = 0;
      await handleIa(staffMessages[0], ['alô']);
      assert.match(edits[0].embeds[0].toJSON().title, /Filtro de conteúdo indisponível/);
      assert.doesNotMatch(JSON.stringify(edits), /resposta_modelo_nao_publicar|erro privado/);
      if (direction === 'input') assert.equal(requests.some(url => url.origin === 'http://127.0.0.1:11435'), false);
    }
  } finally {
    for (const timer of timers) clearInterval(timer);
    globalThis.setInterval = originalSetInterval;
    globalThis.fetch = originalFetch;
    process.chdir(previousCwd);
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    rmSync(temporary, { recursive: true, force: true });
  }
});
