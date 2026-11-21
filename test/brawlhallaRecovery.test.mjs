import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

test('comandos, fallback e capturas semanais durante queda e recuperação da v1', async t => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const intervals = [];
  const dir = mkdtempSync(join(tmpdir(), 'tgg-offline-'));
  const oldEnv = { ...process.env };
  let time = originalNow();
  let recovered = false;
  let playerId = '4165486';
  let rejectLegacyStats = false;
  let memberPoints = 1200;
  let weeklyPoints = 5000;
  let opponentPoints = 7;
  let guildBase = { total_guild_points: 900000, total_xp: 1800 };
  const duelBase = { guild_id: '999', guild_points: 10, xp: 2000 };
  const requests = [];
  const inserts = [];
  const member = { brawlhalla_id: 4165486, name: 'Offline Player', rank: 'Member', join_date: 1000, xp: 500 };
  const user = () => ({ discord_id: '100000000000000001', brawlhalla_id: playerId, role: 'member', active: true });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  Object.assign(process.env, { SUPABASE_URL: 'https://review.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline', SUPABASE_ANON_KEY: 'offline', BRAWLHALLA_API_KEY: 'offline', DISCORD_TOKEN: '', GEMINI_API_KEY: '', BOT_MODE: 'dev', BOT_ADMIN_USER_IDS: user().discord_id, DOTENV_CONFIG_PATH: join(dir, 'absent.env') });
  Date.now = () => time;
  globalThis.setInterval = (...args) => {
    const timer = originalSetInterval(...args);
    intervals.push(timer);
    return timer;
  };
  process.chdir(dir);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    requests.push(url.pathname);
    if (url.hostname === 'review.invalid') {
      if (options.method === 'POST') { inserts.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
      if (url.pathname.endsWith('/users')) {
        const accept = new Headers(options.headers).get('accept');
        return json(accept?.includes('vnd.pgrst.object') ? user() : [user()]);
      }
      if (url.pathname.endsWith('/player_weekly_info')) return json(url.searchParams.get('select') === 'id' ? [] : [{ guild_points: 1000 }]);
      if (url.pathname.endsWith('/guild_weekly_guild_points')) return json(guildBase ? [guildBase] : []);
      if (url.pathname.endsWith('/guild_duels')) return json([duelBase]);
      return json([]);
    }
    assert.equal(url.hostname, 'api.brawlhalla.com', 'nenhuma rede externa é permitida neste teste');
    if (url.pathname.startsWith('/v1/')) {
      if (!recovered) return json({ error_name: 'origin_bad_gateway' }, 502);
      if (url.pathname === '/v1/guild/stats') {
        const id = url.searchParams.get('guild_id');
        const ours = id === '396943';
        return json({ guild_id: Number(id), name: ours ? 'Offline Guild' : 'Opponent Guild', guild_points: ours ? weeklyPoints : opponentPoints, xp: ours ? 2000 : 2050, member_count: 1 });
      }
      if (url.pathname === '/v1/guild/members') return json({ guild_id: 396943, guild_members: [{ ...member, guild_points: memberPoints }] });
      if (url.pathname === '/v1/player/guild') return json({ brawlhalla_id: 4165486, guild: { guild_id: 396943, guild_name: 'Offline Guild', personal_points: 1200, personal_xp_this_week: 20 } });
      return json({ brawlhalla_id: Number(url.searchParams.get('brawlhalla_id')), name: 'Offline Player', level: 10, games: 100, wins: 60 });
    }
    if (url.pathname.startsWith('/clan/')) return json({ clan_id: 396943, clan_name: 'Offline Guild', clan_xp: 2000, clan_lifetime_xp: 3000, clan: [member] });
    if (url.pathname === '/legend/all') return json([{ legend_name_key: 'bodvar', weapon_one: 'Hammer', weapon_two: 'Sword' }]);
    const stats = url.pathname.match(/^\/player\/(\d+)\/stats$/);
    if (stats) return rejectLegacyStats ? json({}, 502) : json({ brawlhalla_id: Number(stats[1]), name: 'Offline Player', level: 10, xp: 2000, games: 100, wins: 60, legends: [] });
    if (/^\/player\/\d+\/ranked$/.test(url.pathname)) return json({ brawlhalla_id: Number(url.pathname.split('/')[2]), name: 'Offline Player', tier: 'Silver', rating: 1200, games: 40, wins: 25, '2v2': [] });
    throw new Error(`Rota inesperada: ${url.pathname}`);
  };
  function message() {
    const replies = [];
    const edits = [];
    const collector = { on() { return collector; } };
    const sent = { edit: async body => { edits.push(body); return sent; }, createMessageComponentCollector: () => collector };
    return { author: { id: user().discord_id }, replies, edits, reply: async body => { replies.push(body); return sent; } };
  }
  try {
    const api = await import('../src/brawlhalla.js');
    const commands = await import('../src/public.js');
    const { ensurePlayerWeeklyInfo } = await import('../src/tggCoins.js');
    const { calcularContribuicoes, MOTIVOS } = await import('../src/services/contribuicaoSemanal.js');
    const { calcularGanhoDaGuildaNaSemana, calcularDueloDaSemana } = await import('../src/services/dueloSemanal.js');
    const { EXECUTORES } = await import('../src/handlers/iaHandlers.js');
    const { handleWam } = await import('../src/admin.js');

    await t.test('.wam aceita admin configurado sem cargo e não grava punição', async () => {
      const msg = message();
      msg.member = { id: msg.author.id, roles: { cache: new Map() } };
      msg.content = '.wam <@100000000000000002> Teste offline';
      const before = inserts.length;
      const client = { guilds: { cache: { get: () => ({ members: { fetch: async () => ({ user: { tag: 'Offline Target' } }) } }) } } };
      await handleWam(msg, ['<@100000000000000002>', 'Teste', 'offline'], client);
      assert.equal(msg.replies.length, 1);
      const embed = msg.replies[0].embeds[0].toJSON();
      assert.match(embed.title, /Aviso Adicionado/);
      assert.match(embed.footer.text, /comando é fake/);
      assert.equal(inserts.length, before);
    });

    await t.test('.stats edita o loading e mantém quatro abas com GP desconhecido', async () => {
      const msg = message();
      await commands.handleStats(msg, [], {});
      assert.equal(msg.replies.length, 1);
      assert.equal(msg.edits.length, 1);
      const result = msg.edits[0];
      assert.match(result.embeds[0].toJSON().title, /Brawlhalla Stats/);
      assert.equal(result.components[0].toJSON().components.length, 4);
      const body = JSON.stringify(result.embeds[0].toJSON());
      assert.match(body, /Pontos de guilda indisponíveis/);
      assert.doesNotMatch(body, /Alerta de Inatividade|Total GP.*0/);
    });

    await t.test('.guild recupera informações antigas sem inventar GP', async () => {
      const msg = message();
      await commands.handleGuild(msg, [], {});
      const embed = msg.edits[0].embeds[0].toJSON();
      assert.match(embed.title, /Offline Guild/);
      assert.match(embed.footer.text, /API antiga/);
      assert.match(JSON.stringify(embed), /GP Semanal.*Indisponível/);
    });

    await t.test('fallback de membros não contamina o cache nem libera dados para automações de GP', async () => {
      const data = await api.fetchGuildMembersNewAPI(undefined, { allowLegacy: true });
      assert.equal(data.guild_members[0].rank, 'Member');
      assert.equal(data.guild_members[0].guild_points, null);
      await assert.rejects(api.fetchGuildMembersNewAPI(), e => e.apiForaDoAr);
      await assert.rejects(api.fetchGuildStatsNewAPI('396943'), e => e.apiForaDoAr);
    });

    await t.test('conta alternativa usa seus próprios dados na API antiga', async () => {
      const data = await api.fetchPlayerBasicNewAPI('123');
      assert.equal(data.brawlhalla_id, '123');
      assert.equal(data.level, 10);
      assert.ok(requests.includes('/player/123/stats'));
    });

    await t.test('captura semanal preserva jogos e salva null quando não foi possível ler GP', async () => {
      await ensurePlayerWeeklyInfo('4165486');
      assert.equal(inserts.at(-1).games, 100);
      assert.equal(inserts.at(-1).guild_points, null);
    });

    await t.test('GP desconhecido não entra como zero no MVP nem na inativação', () => {
      const [row] = calcularContribuicoes({ users: [user()], baseByAccount: new Map([['4165486', 1000]]), membrosDaGuilda: new Map([['4165486', { name: 'Offline Player', points: null }]]), inicioSemanaEmSegundos: 0, entradaRecenteEmSegundos: 0 });
      assert.equal(row.motivo, MOTIVOS.PONTOS_INDISPONIVEIS);
      assert.equal(row.pontosTotais, null);
    });

    await t.test('v1 saudável volta a fornecer GP depois da pausa, sem manter o fallback', async () => {
      recovered = true;
      time += 30_001;
      const data = await api.fetchGuildStatsNewAPI('396943', { allowLegacy: true });
      assert.equal(data.guild_points, 5000);
      assert.notEqual(data.apiSource, 'v0');
      const msg = message();
      await commands.handleStats(msg, [], {});
      const body = JSON.stringify(msg.edits[0].embeds[0].toJSON());
      assert.match(body, /Total GP/);
      assert.doesNotMatch(body, /Pontos de guilda indisponíveis/);
    });

    await t.test('GP válido não transforma XP pessoal ausente em zero', async () => {
      const data = await api.fetchPlayerGuildStats('4165486');
      assert.equal(data.personal_points, 1200);
      assert.equal(data.personal_xp, null);
      assert.equal(data.personal_xp_this_week, 20);
    });

    await t.test('membros presentes sem GP não aparecem como lista vazia no embed', async () => {
      memberPoints = null;
      api.clearCache();
      try {
        const guild = await api.fetchGuildStats('396943');
        const embed = (await api.createGuildEmbed(guild)).toJSON();
        const top = embed.fields.find(field => field.name === '🏆 Top 10 - GP total');
        assert.match(top.value, /Pontos dos membros indisponíveis/);
        assert.doesNotMatch(top.value, /Nenhum membro encontrado/);
      } finally {
        memberPoints = 1200;
        api.clearCache();
      }
    });

    await t.test('total da guilda após reset usa o valor da semana, sem subtrair os 900.000 históricos', async () => {
      weeklyPoints = 42;
      api.clearCache();
      const before = requests.filter(p => p.endsWith('/guild_weekly_guild_points')).length;
      const result = await calcularGanhoDaGuildaNaSemana();
      assert.equal(result.ganhoNaSemana, 42);
      assert.equal(result.pontosAtuais, 42);
      assert.equal(requests.filter(p => p.endsWith('/guild_weekly_guild_points')).length, before);
      const embed = (await api.createGuildEmbed(await api.fetchGuildStats('396943'))).toJSON();
      const info = embed.fields.find(f => f.name === '📊 Info').value;
      assert.match(info, /GP Semanal:\*\* 42/);
      assert.doesNotMatch(info, /GP Totais/);
    });

    await t.test('duelo compara os totais semanais e mantém apenas o XP como diferença', async () => {
      const result = await calcularDueloDaSemana();
      assert.equal(result.nos.ganhoNaSemana, 42);
      assert.equal(result.eles.ganhoNaSemana, 7);
      assert.equal(result.diferenca, 35);
      assert.equal(result.vencendo, 'nos');
      assert.equal(result.nos.ganhoDeXpNaSemana, 200);
      assert.equal(result.eles.ganhoDeXpNaSemana, 50);
    });

    await t.test('reset para zero é uma semana válida e não vira pontos negativos', async () => {
      weeklyPoints = 0;
      api.clearCache();
      assert.equal((await calcularGanhoDaGuildaNaSemana()).ganhoNaSemana, 0);
      const result = await calcularDueloDaSemana();
      assert.equal(result.nos.ganhoNaSemana, 0);
      assert.equal(result.diferenca, 7);
      assert.equal(result.vencendo, 'eles');
    });

    await t.test('sem captura anterior, GP semanal continua disponível e XP fica desconhecido', async () => {
      guildBase = null;
      const result = await calcularDueloDaSemana();
      assert.equal(result.nos.ganhoNaSemana, 0);
      assert.equal(result.nos.ganhoDeXpNaSemana, null);
      assert.equal(result.nos.xpNaVirada, null);
      guildBase = { total_guild_points: 900000, total_xp: 1800 };
    });

    await t.test('cache de outra semana é recusado mesmo quando o timestamp ainda está dentro do TTL', async () => {
      const cachePath = join(dir, 'cache', 'shared.json');
      const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      cache['guild:396943'].data._guildPointsWeek = 'semana-anterior';
      cache['guild:396943'].data.guild_points = 999999;
      cache['guild:396943'].timestamp = time;
      writeFileSync(cachePath, JSON.stringify(cache));
      assert.equal(api.getCachedGuildStats('396943'), null);
      weeklyPoints = 2;
      const msg = message();
      await commands.handleGuild(msg, [], {});
      assert.equal(msg.edits.length, 1);
      const info = msg.edits[0].embeds[0].toJSON().fields.find(f => f.name === '📊 Info').value;
      assert.match(info, /GP Semanal:\*\* 2/);
      assert.equal(api.getCachedGuildStats('396943').guild_points, 2);
    });

    await t.test('executor da IA usa o mesmo placar semanal do duelo e não envia identificadores', async () => {
      weeklyPoints = 42;
      api.clearCache();
      const result = await EXECUTORES.duelo_da_semana({});
      assert.equal(result.dados.nossos_pontos_na_semana, 42);
      assert.equal(result.dados.pontos_do_adversario_na_semana, 7);
      assert.equal(result.dados.diferenca, 35);
      assert.match(result.dados.observacao, /reiniciam semanalmente/);
      assert.doesNotMatch(JSON.stringify(result.dados), /discord_id|brawlhalla_id/);
    });

    await t.test('pontuação zero lida de verdade continua válida na captura e no cálculo', async () => {
      memberPoints = 0;
      api.clearCache();
      await ensurePlayerWeeklyInfo('4165486');
      assert.equal(inserts.at(-1).guild_points, 0);
      const [row] = calcularContribuicoes({ users: [user()], baseByAccount: new Map([['4165486', 0]]), membrosDaGuilda: new Map([['4165486', { name: 'Offline Player', points: 0 }]]), inicioSemanaEmSegundos: 0, entradaRecenteEmSegundos: 0 });
      assert.equal(row.motivo, null);
      assert.equal(row.contribuicao, 0);
    });

    await t.test('GP vencido não é reutilizado quando a API cai novamente', async () => {
      await api.fetchGuildStatsNewAPI('396943');
      recovered = false;
      time += 5 * 60_000 + 1;
      await assert.rejects(api.fetchGuildStatsNewAPI('396943'), e => e.apiForaDoAr);
      await assert.rejects(api.fetchGuildMembersNewAPI(), e => e.apiForaDoAr);
    });

    await t.test('falha também na API antiga substitui o loading, sem duplicar mensagem', async () => {
      playerId = '999';
      rejectLegacyStats = true;
      const msg = message();
      await commands.handleStats(msg, [], {});
      assert.equal(msg.replies.length, 1);
      assert.equal(msg.edits.length, 1);
      assert.match(msg.edits[0].embeds[0].toJSON().title, /Erro ao Buscar/);
    });
  } finally {
    for (const timer of intervals) clearInterval(timer);
    globalThis.setInterval = originalSetInterval;
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    process.chdir(originalCwd);
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
