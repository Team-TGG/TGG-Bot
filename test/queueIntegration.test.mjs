import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

test('queue usa o adapter de slash, paginação e embeds válidos sem rede', async t => {
  const env = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://queue.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline', SUPABASE_ANON_KEY: 'offline', DISCORD_TOKEN: '', BRAWLHALLA_API_KEY: '', GEMINI_API_KEY: '', OPENAI_API_KEY: '', DOTENV_CONFIG_PATH: 'absent-queue-test.env' });
  try {
    const { createQueueHandler } = await import('../src/handlers/queueHandlers.js');
    const { buildQueueEmbed, queuePages } = await import('../src/queueViews.js');
    const { tradutor } = await import('../src/i18n/index.js');
    const { runAsSlash } = await import('../utils/slashAdapter.js');
    const { createPagination } = await import('../utils/discordUtils.js');
    const { publicCommands } = await import('../src/slash/builders/public.js');
    const entry = (patch = {}) => ({ id: '10:20', playerIds: ['10', '20'], name: 'Alpha + Beta', rank: 86, rankBefore: 90, rating: 2466, peak: 2504, games: 280, wins: 165, tier: 'Diamond', since: 600000, lastActivityAt: 900000, ...patch });
    const view = (mode = '2v2', entries = [entry()]) => ({ mode, region: 'BRZ', status: 'ready', entries, players: mode === '2v2' ? 2 : 1, observedAt: 1000000, updatedAt: 900000, nextCheckAt: 1200000, coverage: 500, windowMinutes: 10 });
    const message = () => ({ guild: { iconURL: () => 'https://cdn.discordapp.com/icons/1/icon.png' }, author: { id: '100000000000000001' }, replies: [], async reply(payload) { this.replies.push(payload); } });

    await t.test('builder público oferece 1v1 e 2v2', () => {
      const builder = publicCommands.find(command => command.name === 'queue').toJSON();
      assert.equal(builder.default_member_permissions, undefined);
      assert.deepEqual(builder.options[0].choices.map(choice => choice.value), ['1v1', '2v2']);
    });

    await t.test('slash passa pela deferReply e produz a mesma lista da versão por prefixo', async () => {
      let pagination, reads = 0;
      const handler = createQueueHandler({ getService: () => ({ snapshot: async mode => { reads++; return view(mode); }, poll: () => assert.fail('comando não pode gastar cota da API') }), paginate: async (_source, options) => { pagination = options; return {}; } });
      const interaction = { commandName: 'queue', guild: message().guild, user: message().author, member: null, channel: {}, options: { data: [], getString: () => '2v2' }, async deferReply() { this.deferred = true; } };
      await runAsSlash(handler, interaction, {});
      assert.equal(interaction.deferred, true); assert.equal(reads, 1);
      assert.equal(pagination.getEmbed(1).toJSON().title, '🇧🇷 BRZ • Ranked 2v2');
      assert.equal(pagination.getEmbed(1).toJSON().thumbnail.url, 'attachment://ranked-mascot.png');
      assert.equal(pagination.files[0].name, 'ranked-mascot.png');
      assert.equal((await readFile(pagination.files[0].attachment)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(pagination.extraButtons().length, 3);
      await pagination.onExtra({ customId: 'queue_refresh' }, 2); assert.equal(reads, 2);
      assert.equal(await pagination.onExtra({ customId: 'queue_1v1' }, 2), 1);
      assert.equal(pagination.getEmbed(1).toJSON().title, '🇧🇷 BRZ • Ranked 1v1');
      assert.equal(pagination.getEmbed(1).toJSON().thumbnail.url, 'attachment://ranked-mascot.png');
      await handler(message(), ['2v2']); assert.equal(pagination.getEmbed(1).toJSON().title, '🇧🇷 BRZ • Ranked 2v2');
      await handler(message()); assert.equal(pagination.getEmbed(1).toJSON().title, '🇧🇷 BRZ • Ranked 1v1');
    });

    await t.test('argumento inválido, DM e falha do cache recebem resposta adequada', async () => {
      const handler = createQueueHandler({ getService: () => ({ snapshot: async () => { throw Object.assign(new Error('bad-state'), { queueCode: 'STORAGE' }); } }) });
      const bad = message(); await handler(bad, ['casual']); assert.match(bad.replies[0].embeds[0].toJSON().title, /inválida/);
      const dm = message(); dm.guild = null; await handler(dm); assert.match(dm.replies[0].embeds[0].toJSON().description, /dentro do servidor/);
      const unavailable = message(); await handler(unavailable); assert.match(unavailable.replies[0].embeds[0].toJSON().description, /monitor está indisponível/);
    });

    await t.test('embed organiza duplas, ELO, posição, taxa, sessão e atualização em português e inglês', () => {
      for (const language of ['pt', 'en']) {
        const data = buildQueueEmbed(view(), 1, tradutor(language)).toJSON();
        const player = data.fields.find(field => field.name.includes('Alpha'));
        assert.equal(data.title, '🇧🇷 BRZ • Ranked 2v2'); assert.match(player.name, /Alpha \+ Beta/);
        assert.match(player.value, language === 'pt' ? /2\.466/ : /2,466/);
        assert.match(player.value, /\#86 \(\+4\)/);
        assert.match(player.value, language === 'pt' ? /58,9%/ : /58\.9%/);
        assert.match(player.value, /<t:600:R>/); assert.match(player.value, /<t:900:R>/);
        assert.match(data.fields.at(-1).value, /<t:1200:R>/);
        assert.match(data.description, language === 'pt' ? /2 jogadores/ : /2 players/);
      }
    });

    await t.test('base inicial ou API fora do ar não são apresentadas como fila confirmada vazia', () => {
      for (const status of ['warming', 'unavailable', 'stale']) {
        const data = buildQueueEmbed({ ...view('1v1', []), status }, 1, tradutor('pt')).toJSON();
        assert.doesNotMatch(data.description, /0 jogadores/);
        assert.ok(!data.fields.some(field => field.name === 'Nenhuma atividade recente detectada'));
      }
      const data = buildQueueEmbed(view('1v1', []), 1, tradutor('pt')).toJSON();
      assert.ok(data.fields.some(field => field.name === 'Nenhuma atividade recente detectada'));
    });

    await t.test('nomes longos e caracteres de formatação ficam dentro dos limites do Discord', () => {
      const entries = Array.from({ length: 25 }, (_, index) => entry({ id: String(index), name: '**[<@everyone>](https://example.com)🌻'.repeat(20), tier: index % 2 ? 'Valhallan' : '**'.repeat(250), rating: Number.MAX_SAFE_INTEGER, peak: Number.MAX_SAFE_INTEGER, games: Number.MAX_SAFE_INTEGER, wins: Number.MAX_SAFE_INTEGER, rank: Number.MAX_SAFE_INTEGER, rankBefore: 1 }));
      const state = view('2v2', entries);
      assert.equal(queuePages(state), 4);
      const data = buildQueueEmbed(state, 1, tradutor('pt')).toJSON();
      assert.equal(data.fields.length, 13);
      assert.ok(data.fields.every(field => field.name.length <= 256 && field.value.length <= 1024));
      const size = data.title.length + data.description.length + data.footer.text.length + data.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
      assert.ok(size <= 6000); assert.doesNotMatch(data.fields[0].name, /<@everyone>/);
    });

    await t.test('controles de paginação são exclusivos do autor e desativados ao expirar', async () => {
      const collector = new EventEmitter(), edits = [];
      const source = message(); let initial, changed = 0;
      const sent = { createMessageComponentCollector: () => collector, edit: async payload => edits.push(payload) };
      source.reply = async payload => { initial = payload; return sent; };
      const files = [{ attachment: Buffer.from('image'), name: 'ranked-mascot.png' }];
      await createPagination(source, { getEmbed: () => buildQueueEmbed(view(), 1, tradutor('pt')), getTotalPages: () => 1, files, disableOnEnd: true, onExtra: async () => { changed++; } });
      assert.equal(initial.components[0].components.length, 2);
      assert.equal(initial.files, files);
      const rejected = [];
      await collector.listeners('collect')[0]({ user: { id: 'another-user' }, reply: async payload => rejected.push(payload) });
      assert.equal(changed, 0); assert.equal(rejected.length, 1);
      await collector.listeners('collect')[0]({ user: source.author, customId: 'queue_refresh', deferUpdate: async () => {}, editReply: async payload => edits.push(payload) });
      assert.equal(changed, 1);
      assert.equal(edits[0].embeds[0].toJSON().thumbnail.url, 'attachment://ranked-mascot.png');
      assert.ok(!Object.hasOwn(edits[0], 'files') && !Object.hasOwn(edits[0], 'attachments'), 'atualizações preservam o anexo original');
      await collector.listeners('end')[0]();
      assert.ok(edits.at(-1).components[0].components.every(button => button.data.disabled));
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
