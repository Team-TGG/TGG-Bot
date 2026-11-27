import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ChannelType, Collection, PermissionFlagsBits } from 'discord.js';

test('formulário, prévia, publicação, elegibilidade e gerenciamento sem rede Discord real', async t => {
  const originalCwd = process.cwd(), originalFetch = globalThis.fetch, originalEnv = { ...process.env };
  const temporary = await mkdtemp(join(tmpdir(), 'tgg-giveaway-ui-'));
  const server = '100000000000000001', host = '100000000000000002', channelId = '100000000000000003';
  const memberId = '100000000000000004', visitorId = '100000000000000005', otherStaff = '100000000000000006', botId = '100000000000000007';
  const targetChannelId = '100000000000000008', roleId = '100000000000000009', lockedRoleId = '100000000000000010';
  const active = new Set([memberId, host]), people = new Map();
  let dbDown = false, dbReads = 0, nextMessage = 200000000000000000n, sends = 0;
  let botCanMention = false, hostCanMention = false;
  const published = new Map();
  const roles = new Map([[roleId, { id: roleId, guild: { id: server }, mentionable: true }], [lockedRoleId, { id: lockedRoleId, guild: { id: server }, mentionable: false }], [server, { id: server, guild: { id: server }, mentionable: true }]]);
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
    const { buildSorteioForm, buildSorteioVisualForm, buildSorteioTextForm, buildSorteioMediaForm, buildSorteioChannelForm, buildSorteioPreview, buildSorteioEmbed } = await import('../src/sorteiosViews.js');
    const { adminCommands } = await import('../src/slash/builders/admin.js');
    const person = (id, staff = false, bot = false) => ({ id, user: { id, bot }, roles: { cache: new Map(staff ? [[STAFF_ROLE_IDS.helper, { id: STAFF_ROLE_IDS.helper }]] : []) } });
    people.set(host, person(host, true)); people.set(memberId, person(memberId)); people.set(visitorId, person(visitorId)); people.set(otherStaff, person(otherStaff, true)); people.set(botId, person(botId, false, true));
    const guild = { id: server, roles: { fetch: async id => roles.get(id) || null }, members: { fetchMe: async () => people.get(botId), fetch: async options => {
      if (Array.isArray(options?.user)) return new Map(options.user.filter(id => people.has(id)).map(id => [id, people.get(id)]));
      const member = people.get(typeof options === 'string' ? options : options.user);
      if (!member) throw Object.assign(new Error('unknown-member'), { code: 10007 });
      return member;
    } } };
    const send = async (payload, destination) => { sends++; const message = { id: String(++nextMessage), channelId: destination, author: { id: botId }, payload, edits: [], components: wireComponents(payload), edit: async next => { message.edits.push(next); message.payload = { ...message.payload, ...next }; message.components = wireComponents(next); return message; } }; published.set(message.id, message); return message; };
    const channel = { id: channelId, guildId: server, guild, type: ChannelType.GuildText, permissionsFor: member => ({ has: permission => permission === PermissionFlagsBits.MentionEveryone ? (member.id === botId ? botCanMention : hostCanMention) : true }),
      send: payload => send(payload, channelId),
      messages: { fetch: async input => typeof input === 'string' ? published.get(input) : published } };
    const targetChannel = { ...channel, id: targetChannelId, send: payload => send(payload, targetChannelId) };
    const client = { user: { id: botId }, channels: { fetch: async id => id === channelId ? channel : id === targetChannelId ? targetChannel : null }, guilds: { fetch: async id => { assert.equal(id, server); return guild; }, cache: new Map([[server, guild]]) } };
    const service = getSorteiosService(client), handlers = createSorteioHandlers({ getService: () => service });
    function event(userId = host, customId) {
      const event = { customId, user: { id: userId, bot: userId === botId }, member: people.get(userId), guild, guildId: server, channel, channelId,
        options: { data: [], getString: () => null, getChannel: () => null, getRole: () => null }, commandName: 'sorteio', replies: [], edits: [], modals: [],
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
      assert.match(preview.content, /PRÉVIA — ainda não publicado/);
      assert.equal(preview.components[0].components.length, 2);
      assert.ok(preview.components[0].components.every(button => button.data.disabled));
      assert.equal(preview.components[1].components.length, 5);
      assert.equal(preview.components[1].components[0].data.disabled, false);
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
        for (const builder of [buildSorteioForm({ ...draft, locale }), buildSorteioVisualForm({ ...draft, locale }), buildSorteioTextForm({ ...draft, locale }), buildSorteioMediaForm({ ...draft, locale }), buildSorteioChannelForm({ ...draft, locale })]) {
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

    let styledDraft;
    await t.test('canal e cargo podem ser escolhidos antes de preencher o prêmio, sem publicar nem marcar ninguém', async () => {
      styledDraft = await service.createDraft({ guildId: server, ownerId: host, channelId });
      const before = sends;
      const target = event(host, `sorteio_channel:${styledDraft.id}`);
      target.fields = { getSelectedChannels: () => new Collection([[targetChannelId, targetChannel]]), getSelectedRoles: () => new Collection([[roleId, roles.get(roleId)]]) };
      await handlers.interaction(target, client);
      styledDraft = await service.getDraft(styledDraft.id, host, server);
      assert.equal(styledDraft.channelId, targetChannelId); assert.equal(styledDraft.roleId, roleId);
      assert.match(target.edits[0].content, new RegExp(targetChannelId));
      assert.match(target.edits[0].content, new RegExp(roleId));
      assert.deepEqual(target.edits[0].allowedMentions.parse, []);
      assert.equal(target.edits[0].components[1].components[0].data.disabled, true);
      assert.equal(sends, before);
      await assert.rejects(service.publishDraft(styledDraft.id, host, server), { sorteioCode: 'TEXT' });
      const modal = buildSorteioChannelForm(styledDraft).toJSON();
      assert.equal(modal.components.length, 2);
      assert.equal(modal.components[1].component.required, false);
      assert.deepEqual(modal.components[1].component.default_values, [{ id: roleId, type: 'role' }]);
    });

    await t.test('textos, Markdown, rodapé, botões, cor e imagens aparecem na prévia antes de salvar a publicação', async () => {
      await service.updateDraft(styledDraft.id, host, server, { prize: 'Passe VIP' });
      const texts = event(host, `sorteio_texts:${styledDraft.id}`);
      texts.fields = { getTextInputValue: name => ({ title: '🎉 FESTA TGG', description: '**Prêmio especial**\n- Confira as regras', footer: 'Boa sorte, TGG!', join_label: '🎉 Quero ganhar!', leave_label: 'Retirar entrada' })[name] };
      const before = sends;
      await handlers.interaction(texts, client);
      const preview = texts.edits[0], embed = preview.embeds[0].toJSON();
      assert.equal(embed.title, '🎉 FESTA TGG'); assert.match(embed.description, /\*\*Prêmio especial\*\*/);
      assert.ok(embed.footer.text.startsWith('Boa sorte, TGG!'));
      assert.equal(embed.fields.find(field => field.name === 'Prêmio').value, 'Passe VIP');
      assert.equal(preview.components[0].components[0].data.label, '🎉 Quero ganhar!');
      assert.equal(preview.components[0].components[1].data.label, 'Retirar entrada');
      assert.ok(preview.components[0].components.every(button => button.data.disabled));
      const images = event(host, `sorteio_media:${styledDraft.id}`);
      images.fields = { getTextInputValue: name => ({ color: '#FF8800', image: 'https://example.com/banner.png', thumbnail: 'https://example.com/icon.png' })[name] };
      await handlers.interaction(images, client);
      const imageEmbed = images.edits[0].embeds[0].toJSON();
      assert.equal(imageEmbed.color, 0xff8800); assert.equal(imageEmbed.image.url, 'https://example.com/banner.png');
      assert.equal(imageEmbed.thumbnail.url, 'https://example.com/icon.png');
      assert.equal(sends, before);
    });

    await t.test('somente Publicar envia ao canal escolhido e permite a menção de um único cargo', async () => {
      const before = sends;
      const publish = event(host, `sorteio_publish:${styledDraft.id}`);
      await handlers.interaction(publish, client);
      const record = await service.get(styledDraft.id, server), message = published.get(record.messageId);
      assert.equal(message.channelId, targetChannelId);
      assert.equal(message.payload.content, `<@&${roleId}>`);
      assert.deepEqual(message.payload.allowedMentions, { parse: [], roles: [roleId], users: [], repliedUser: false });
      assert.equal(message.payload.embeds[0].toJSON().title, '🎉 FESTA TGG');
      assert.equal(message.payload.components[0].components[0].data.label, '🎉 Quero ganhar!');
      assert.equal(publish.edits[0].content, '', 'a confirmação deve remover o aviso antigo de prévia');
      await service.sync(record);
      assert.deepEqual(message.edits.at(-1).allowedMentions.parse, []);
      assert.equal(message.edits.at(-1).allowedMentions.roles, undefined, 'atualizações não podem marcar o cargo de novo');
      assert.equal(sends, before + 1);
    });

    await t.test('limpar o seletor remove o cargo e a prévia volta a indicar sem marcação', async () => {
      const draft = await service.createDraft({ guildId: server, ownerId: host, channelId, roleId });
      const target = event(host, `sorteio_channel:${draft.id}`);
      target.fields = { getSelectedChannels: () => new Collection([[channelId, channel]]), getSelectedRoles: () => new Collection() };
      await handlers.interaction(target, client);
      assert.equal((await service.getDraft(draft.id, host, server)).roleId, null);
      assert.match(target.edits[0].content, /Nenhum cargo/);
    });

    await t.test('cargos apagados, @everyone e falta de permissão impedem publicação', async () => {
      const before = sends;
      for (const id of [server, '100000000000000099']) {
        const draft = await service.createDraft({ guildId: server, ownerId: host, channelId });
        await service.updateDraft(draft.id, host, server, { prize: 'Cargo inválido', roleId: id });
        await assert.rejects(service.publishDraft(draft.id, host, server), { sorteioCode: 'ROLE' });
      }
      const draft = await service.createDraft({ guildId: server, ownerId: host, channelId });
      await service.updateDraft(draft.id, host, server, { prize: 'Cargo com permissão', roleId: lockedRoleId });
      for (const [botPermission, hostPermission] of [[false, false], [true, false], [false, true]]) {
        botCanMention = botPermission; hostCanMention = hostPermission;
        await assert.rejects(service.publishDraft(draft.id, host, server), { sorteioCode: 'ROLE_PERMISSIONS' });
      }
      assert.equal(sends, before);
      botCanMention = true; hostCanMention = true;
      const record = await service.publishDraft(draft.id, host, server);
      assert.equal(published.get(record.messageId).payload.content, `<@&${lockedRoleId}>`);
      botCanMention = false; hostCanMention = false;
    });

    await t.test('opções canal e cargo do slash são preservadas ao abrir o formulário', async () => {
      const interaction = event();
      interaction.options.getChannel = name => name === 'canal' ? targetChannel : null;
      interaction.options.getRole = name => name === 'cargo' ? roles.get(roleId) : null;
      await runAsSlash(handlers.command, interaction, client);
      const id = interaction.modals[0].custom_id.split(':')[1];
      const draft = await service.getDraft(id, host, server);
      assert.equal(draft.channelId, targetChannelId); assert.equal(draft.roleId, roleId);
    });

    await t.test('máximos de texto continuam dentro do limite total do embed Discord', async () => {
      const record = await service.get(styledDraft.id, server);
      const data = buildSorteioEmbed({ ...record, title: 't'.repeat(200), description: 'd'.repeat(4000), footer: 'f'.repeat(200) }).toJSON();
      const total = data.title.length + data.description.length + data.footer.text.length + data.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
      assert.ok(total <= 6000);
    });
  } finally {
    globalThis.fetch = originalFetch; process.chdir(originalCwd);
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    await rm(temporary, { recursive: true, force: true });
  }
});
