import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ChannelType } from 'discord.js';

test('formulário, prévia, publicação, elegibilidade e gerenciamento sem rede Discord real', async t => {
  const originalCwd = process.cwd(), originalFetch = globalThis.fetch, originalEnv = { ...process.env };
  const temporary = await mkdtemp(join(tmpdir(), 'tgg-giveaway-ui-'));
  const server = '100000000000000001', host = '100000000000000002', channelId = '100000000000000003';
  const memberId = '100000000000000004', visitorId = '100000000000000005', otherStaff = '100000000000000006', botId = '100000000000000007';
  const active = new Set([memberId, host]), people = new Map();
  let dbDown = false, dbReads = 0, nextMessage = 200000000000000000n, sends = 0;
  const published = new Map();
    const wireComponents = payload => payload.components.map(row => ({ components: row.toJSON().components.map(component => ({ customId: component.custom_id })) }));
  Object.assign(process.env, { SUPABASE_URL: 'https://giveaway.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline', SUPABASE_ANON_KEY: 'offline', BOT_ADMIN_USER_IDS: host, DISCORD_TOKEN: '', OPENAI_API_KEY: '', BRAWLHALLA_API_KEY: 'offline', DOTENV_CONFIG_PATH: join(temporary, 'absent.env') });
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'giveaway.invalid', 'somente o banco falso pode receber uma consulta');
    dbReads++;
    if (dbDown) return new Response(JSON.stringify({ error: 'offline' }), { status: 503 });
    let ids = [...people.keys()];
    const filter = url.searchParams.get('discord_id');
    if (filter?.startsWith('eq.')) ids = [filter.slice(3)];
    if (filter?.startsWith('in.')) ids = filter.slice(4, -1).replaceAll('"', '').split(',');
    const rows = ids.filter(id => !url.searchParams.has('active') || active.has(id)).map(id => ({ discord_id: id, active: active.has(id), brawlhalla_id: active.has(id) ? 42 : null, role: 'member' }));
    const object = new Headers(options.headers).get('accept')?.includes('vnd.pgrst.object');
    return new Response(JSON.stringify(object ? rows[0] || null : rows), { headers: { 'Content-Type': 'application/json' } });
  };
  process.chdir(temporary);
  try {
    const { STAFF_ROLE_IDS } = await import('../config/index.js');
    const { getSorteiosService } = await import('../src/services/sorteiosRuntime.js');
    const { createSorteioHandlers } = await import('../src/handlers/sorteiosHandlers.js');
    const { runAsSlash } = await import('../utils/slashAdapter.js');
    const { buildSorteioForm, buildSorteioVisualForm, buildSorteioChannelForm, buildSorteioPreview, buildSorteioEmbed } = await import('../src/sorteiosViews.js');
    const { adminCommands } = await import('../src/slash/builders/admin.js');
    const person = (id, staff = false, bot = false) => ({ id, user: { id, bot }, roles: { cache: new Map(staff ? [[STAFF_ROLE_IDS.helper, { id: STAFF_ROLE_IDS.helper }]] : []) } });
    people.set(host, person(host, true)); people.set(memberId, person(memberId)); people.set(visitorId, person(visitorId)); people.set(otherStaff, person(otherStaff, true)); people.set(botId, person(botId, false, true));
    const guild = { id: server, members: { fetchMe: async () => people.get(botId), fetch: async options => {
      if (Array.isArray(options?.user)) return new Map(options.user.filter(id => people.has(id)).map(id => [id, people.get(id)]));
      const member = people.get(typeof options === 'string' ? options : options.user);
      if (!member) throw Object.assign(new Error('unknown-member'), { code: 10007 });
      return member;
    } } };
    const channel = { id: channelId, guildId: server, guild, type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }),
      send: async payload => { sends++; const message = { id: String(++nextMessage), author: { id: botId }, payload, components: wireComponents(payload), edit: async next => { message.payload = next; message.components = wireComponents(next); return message; } }; published.set(message.id, message); return message; },
      messages: { fetch: async input => typeof input === 'string' ? published.get(input) : published } };
    const client = { user: { id: botId }, channels: { fetch: async id => id === channelId ? channel : null }, guilds: { fetch: async id => { assert.equal(id, server); return guild; }, cache: new Map([[server, guild]]) } };
    const service = getSorteiosService(client), handlers = createSorteioHandlers({ getService: () => service });
    function event(userId = host, customId) {
      const event = { customId, user: { id: userId, bot: userId === botId }, member: people.get(userId), guild, guildId: server, channel, channelId,
        options: { data: [], getString: () => null, getChannel: () => null }, commandName: 'sorteio', replies: [], edits: [], modals: [],
        deferReply: async () => { event.deferred = true; }, deferUpdate: async () => { event.deferred = true; },
        reply: async payload => { event.replied = true; event.replies.push(payload); return {}; }, fetchReply: async () => ({}),
        editReply: async payload => { event.edits.push(payload); return {}; }, update: async payload => { event.replied = true; event.edits.push(payload); return {}; },
        showModal: async modal => { event.replied = true; event.modals.push(modal.toJSON()); } };
      return event;
    }

    let draftId;
    await t.test('/sorteio abre modal direto, sem deferReply que impediria o formulário', async () => {
      const interaction = event();
      await runAsSlash(handlers.command, interaction, client);
      assert.equal(interaction.deferred, undefined);
      assert.equal(interaction.modals.length, 1);
      const modal = interaction.modals[0];
      assert.equal(modal.components.length, 5);
      assert.ok(modal.components.every(component => component.type === 18));
      assert.deepEqual(modal.components[4].component.options.map(option => option.value), ['members', 'all']);
      assert.match(modal.components[0].component.placeholder, /Passe de Batalha/);
      draftId = modal.custom_id.split(':')[1];
      const builder = adminCommands.find(command => command.name === 'sorteio').toJSON();
      assert.equal(builder.default_member_permissions, undefined);
      assert.ok(builder.options.some(option => option.name === 'acao'));
    });

    await t.test('enviar formulário só mostra uma prévia fiel; ainda não publica mensagem', async () => {
      const modal = event(host, `sorteio_form:${draftId}`);
      modal.fields = { getTextInputValue: name => ({ prize: 'Passe TGG de teste', description: 'Prêmio entregue pelo organizador.', winners: '2', duration: '2d 3h 30m' })[name], getStringSelectValues: () => ['members'] };
      await handlers.interaction(modal, client);
      assert.equal(sends, 0);
      const preview = modal.edits[0], embed = preview.embeds[0].toJSON();
      assert.match(embed.title, /Passe TGG de teste/);
      assert.match(embed.fields.find(field => field.name === 'Status').value, /Prévia/);
      assert.equal(preview.components[0].components.length, 5);
      assert.equal(preview.components[0].components[0].data.disabled, false);
      const draft = await service.getDraft(draftId, host, server);
      assert.equal(draft.durationMs, (2 * 1440 + 3 * 60 + 30) * 60000);
    });

    await t.test('dias/horas/minutos, cor e imagem atualizam a prévia e os modais são válidos', async () => {
      const modal = event(host, `sorteio_visual:${draftId}`);
      modal.fields = { getTextInputValue: name => ({ days: '0', hours: '1', minutes: '30', color: '#00FF00', image: 'https://example.com/prize.png' })[name] };
      await handlers.interaction(modal, client);
      const draft = await service.getDraft(draftId, host, server);
      const embed = modal.edits[0].embeds[0].toJSON();
      assert.equal(draft.durationMs, 5400000); assert.equal(embed.color, 0x00ff00); assert.equal(embed.image.url, 'https://example.com/prize.png');
      for (const locale of ['pt', 'en']) {
        for (const builder of [buildSorteioForm({ ...draft, locale }), buildSorteioVisualForm({ ...draft, locale }), buildSorteioChannelForm({ ...draft, locale })]) {
          const data = builder.toJSON(); assert.ok(data.components.length <= 5); assert.ok(data.title.length <= 45);
        }
        assert.ok(buildSorteioPreview({ ...draft, locale }).embeds[0].toJSON().title);
      }
    });

    await t.test('membro comum não cria sorteios e outro staff não altera a prévia do organizador', async () => {
      const outsider = event(visitorId); outsider.author = outsider.user; outsider.reply = async payload => outsider.replies.push(payload);
      await handlers.command(outsider, [], client);
      assert.match(outsider.replies[0].embeds[0].toJSON().description, /Apenas assistants/);
      await assert.rejects(handlers.interaction(event(otherStaff, `sorteio_publish:${draftId}`), client), { sorteioCode: 'DRAFT' });
      assert.equal(sends, 0);
    });

    let record, openRecord;
    await t.test('publicação confirmada gera embed e botões, sem pings automáticos', async () => {
      const interaction = event(host, `sorteio_publish:${draftId}`);
      await handlers.interaction(interaction, client);
      record = await service.get(draftId, server);
      assert.equal(sends, 1); assert.equal(record.status, 'active');
      const message = published.get(record.messageId);
      assert.deepEqual(message.payload.allowedMentions.parse, []);
      assert.equal(message.payload.components[0].components.length, 2);
      assert.match(interaction.edits[0].embeds[0].toJSON().description, /discord.com\/channels/);
    });

    const enter = async (userId, target = record) => {
      const interaction = event(userId, `sorteio_join:${target.id}`);
      interaction.message = published.get(target.messageId);
      await handlers.interaction(interaction, client);
      return interaction;
    };
    await t.test('membros apenas usa cadastro ativo; bots e visitantes são recusados', async () => {
      await assert.rejects(enter(visitorId), { sorteioCode: 'MEMBERS_ONLY' });
      await assert.rejects(enter(botId), { sorteioCode: 'MESSAGE' });
      const first = await enter(memberId), duplicate = await enter(memberId);
      assert.match(first.edits[0].embeds[0].toJSON().description, /Boa sorte/);
      assert.match(duplicate.edits[0].embeds[0].toJSON().description, /já está participando/);
      assert.deepEqual((await service.get(record.id, server)).entries, [memberId]);
    });

    await t.test('todos do servidor aceita visitante e não depende do cadastro da TGG', async () => {
      const draft = await service.createDraft({ guildId: server, ownerId: host, channelId });
      await service.updateDraft(draft.id, host, server, { prize: 'Sorteio aberto', audience: 'all' });
      const open = await service.publishDraft(draft.id, host, server);
      openRecord = open;
      const reads = dbReads;
      await enter(visitorId, open);
      assert.equal(dbReads, reads);
      assert.deepEqual((await service.get(open.id, server)).entries, [visitorId]);
    });

    await t.test('saída é permitida e perda de vínculo antes do resultado exclui o participante', async () => {
      await enter(host);
      const leave = event(memberId, `sorteio_leave:${record.id}`); leave.message = published.get(record.messageId);
      await handlers.interaction(leave, client);
      assert.match(leave.edits[0].embeds[0].toJSON().description, /removida/);
      await enter(memberId); active.delete(memberId);
      const result = await service.draw(record.id, server, { manual: true });
      assert.deepEqual(result.winners, [host]);
      await service.sync(result);
      assert.ok(buildSorteioEmbed(result).toJSON().fields.find(field => field.name === 'Encerramento').value.includes(String(Math.floor(result.drawnAt / 1000))));
      const message = published.get(record.messageId);
      assert.ok(message.payload.components[0].components.every(button => button.data.disabled));
      assert.match(message.payload.embeds[0].toJSON().fields.at(-1).value, new RegExp(host));
    });

    await t.test('confirmações são exclusivas do autor e membros não gerenciam sorteios', async () => {
      await assert.rejects(handlers.interaction(event(visitorId, `sorteio_askReroll:${record.id}`), client), { sorteioCode: 'MANAGER' });
      await assert.rejects(handlers.interaction(event(otherStaff, `sorteio_reroll:${record.id}:${host}`), client), { sorteioCode: 'ACTION_OWNER' });
      const confirmation = event(host, `sorteio_askReroll:${record.id}`);
      await handlers.interaction(confirmation, client);
      assert.match(confirmation.replies[0].components[0].components[0].data.custom_id, /sorteio_reroll/);
    });

    await t.test('banco indisponível não autoriza visitante em sorteio exclusivo para membros', async () => {
      const draft = await service.createDraft({ guildId: server, ownerId: host, channelId });
      await service.updateDraft(draft.id, host, server, { prize: 'Somente TGG', audience: 'members' });
      const restricted = await service.publishDraft(draft.id, host, server);
      dbDown = true;
      await assert.rejects(enter(visitorId, restricted));
      assert.deepEqual((await service.get(restricted.id, server)).entries, []);
      dbDown = false;
    });

    await t.test('gerenciar por link recupera publicação cujo ID não foi salvo antes da queda', async () => {
      const draft = await service.createDraft({ guildId: server, ownerId: host, channelId });
      await service.updateDraft(draft.id, host, server, { prize: 'Recuperação por link', audience: 'all' });
      const originalSend = channel.send;
      channel.send = async payload => { await originalSend(payload); throw new Error('connection-reset-after-send'); };
      await assert.rejects(service.publishDraft(draft.id, host, server)); channel.send = originalSend;
      const pending = await service.get(draft.id, server);
      assert.equal(pending.messageId, null);
      const message = [...published.values()].at(-1);
      const manager = event(); manager.author = manager.user;
      await handlers.command(manager, ['gerenciar', `https://discord.com/channels/${server}/${channelId}/${message.id}`], client);
      assert.equal((await service.get(draft.id, server)).messageId, message.id);
      assert.match(manager.replies[0].embeds[0].toJSON().title, /Recuperação por link/);
    });

    await t.test('quem saiu do servidor não ganha nem no modo aberto para todos', async () => {
      people.delete(visitorId);
      const result = await service.draw(openRecord.id, server, { manual: true });
      assert.equal(result.status, 'ended'); assert.deepEqual(result.winners, []);
    });
  } finally {
    globalThis.fetch = originalFetch; process.chdir(originalCwd);
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    await rm(temporary, { recursive: true, force: true });
  }
});
