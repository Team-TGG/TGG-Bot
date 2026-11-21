import test from 'node:test';
import assert from 'node:assert/strict';
import { createIaSafety } from '../src/services/iaSafety.js';

const settings = { openaiApiKey: 'chave-offline-privada', safetyModel: 'gpt-6-luna', timeoutMs: 1000 };
const categories = { sexual: false, 'sexual/minors': false, harassment: false, 'harassment/threatening': false,
  hate: false, 'hate/threatening': false, illicit: false, 'illicit/violent': false, 'self-harm': false,
  'self-harm/intent': false, 'self-harm/instructions': false, violence: false, 'violence/graphic': false };
const native = (overrides = {}) => { const values = { ...categories, ...overrides }; return { results: [{ flagged: Object.values(values).some(Boolean), categories: values }] }; };
const decision = (allowed = true, reason = 'permitted') => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ allowed, reason }) }] }] });
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function mock(...replies) {
  const requests = [];
  const client = createIaSafety(settings, { fetchImpl: async (url, options) => {
    requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    assert.ok(replies.length, 'chamada inesperada');
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : json(next);
  } });
  return { client, requests };
}

test('pergunta permitida precisa passar moderação e política do Discord', async () => {
  const { client, requests } = mock(native(), decision());
  assert.deepEqual(await client.check('Como melhorar os combos?', { direction: 'input' }), { allowed: true, reason: 'permitted' });
  assert.equal(requests[0].url, 'https://api.openai.com/v1/moderations');
  assert.equal(requests[0].body.model, 'omni-moderation-latest');
  assert.equal(requests[1].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[1].body.store, false);
  assert.equal(requests[1].body.text.format.strict, true);
  assert.equal(requests[1].body.tools, undefined);
  assert.deepEqual(JSON.parse(requests[1].body.input[0].content), { direction: 'input', text: 'Como melhorar os combos?' });
  for (const request of requests) {
    assert.equal(request.headers.Authorization, `Bearer ${settings.openaiApiKey}`);
    assert.equal(request.url.includes(settings.openaiApiKey), false);
    assert.equal(JSON.stringify(request.body).includes(settings.openaiApiKey), false);
  }
});

test('categorias explícitas ou perigosas bloqueiam sem consultar geração/classificação adicional', async () => {
  for (const category of ['sexual', 'sexual/minors', 'violence/graphic', 'harassment/threatening', 'hate/threatening', 'self-harm/instructions']) {
    const { client, requests } = mock(native({ [category]: true }));
    assert.equal((await client.check('Texto de teste de categoria', { direction: 'input' })).allowed, false);
    assert.equal(requests.length, 1);
  }
});

test('contexto de jogo e pedido de apoio não são bloqueados por violência fictícia ou intenção pessoal', async () => {
  for (const flagged of [{ violence: true, 'illicit/violent': true }, { 'self-harm': true, 'self-harm/intent': true }]) {
    const { client } = mock(native(flagged), decision());
    assert.equal((await client.check('Contexto seguro e não gráfico', { direction: 'input' })).allowed, true);
  }
});

test('violência real marcada na moderação continua bloqueada pela análise contextual', async () => {
  const { client } = mock(native({ violence: true, 'illicit/violent': true }), decision(false, 'illegal_harm'));
  assert.equal((await client.check('Pedido de violência real', { direction: 'input' })).allowed, false);
});

test('categorias específicas do Discord bloqueiam mesmo sem alerta na moderação geral', async () => {
  for (const reason of ['privacy_credentials', 'scams_spam', 'platform_abuse', 'illegal_harm', 'harmful_misinformation', 'harassment_hate']) {
    const { client } = mock(native(), decision(false, reason));
    assert.deepEqual(await client.check('Pedido reprovado pela política contextual', { direction: 'input' }), { allowed: false, reason });
  }
});

test('conteúdo de saída completo é enviado ao filtro sem cortar campos ou o final', async () => {
  const text = JSON.stringify({ resposta: 'Resumo seguro', embed: { title: 'Perfil', fields: [{ name: 'Guilda', value: 'Conteúdo a conferir' }] } }) + ' final-verificado';
  const { client, requests } = mock(native(), decision(false, 'harassment_hate'));
  assert.equal((await client.check(text, { direction: 'output' })).allowed, false);
  assert.equal(requests[0].body.input, text);
  assert.deepEqual(JSON.parse(requests[1].body.input[0].content), { direction: 'output', text });
});

test('letras largas e caracteres invisíveis são normalizados antes das duas análises', async () => {
  const { client, requests } = mock(native(), decision());
  await client.check('ｔｅｘｔｏ\u200b\u202e seguro', { direction: 'input' });
  assert.equal(requests[0].body.input, 'texto seguro');
  assert.equal(JSON.parse(requests[1].body.input[0].content).text, 'texto seguro');
});

test('credenciais reconhecíveis são bloqueadas localmente sem enviá-las à API', async () => {
  const client = createIaSafety(settings, { fetchImpl: async () => assert.fail('credencial não pode sair do bot') });
  for (const text of ['sk-proj-' + 'a'.repeat(30), 'mfa.' + 'b'.repeat(30), `${'a'.repeat(24)}.${'b'.repeat(6)}.${'c'.repeat(30)}`, '-----BEGIN OPENSSH PRIVATE KEY-----']) {
    assert.deepEqual(await client.check(text, { direction: 'input' }), { allowed: false, reason: 'privacy_credentials' });
  }
});

test('sem chave ou com conteúdo inválido o filtro não libera a resposta', async () => {
  const client = createIaSafety({}, { fetchImpl: async () => assert.fail('não deveria chamar a rede') });
  await assert.rejects(client.check('alô', { direction: 'input' }), { iaSafetyUnavailable: true });
  const configured = createIaSafety(settings, { fetchImpl: async () => assert.fail('entrada inválida não deve ir à rede') });
  for (const [text, direction] of [['', 'input'], ['a'.repeat(24001), 'output'], ['alô', 'invalid'], [null, 'input']]) {
    await assert.rejects(configured.check(text, { direction }), { iaSafetyUnavailable: true });
  }
});

test('queda, limite ou resposta inválida da moderação fecham o acesso sem expor o corpo de erro', async () => {
  for (const response of [new Error('credencial privada'), new Response('credencial privada', { status: 429 }), new Response('não é JSON'), {}, { results: [{ categories, flagged: true }] }, { results: [{ categories: {}, flagged: false }] }]) {
    const { client } = mock(response);
    await assert.rejects(client.check('alô', { direction: 'input' }), error => error.iaSafetyUnavailable === true && !error.message.includes('credencial privada'));
  }
});

test('classificador incompleto, recusa, JSON malformado ou decisão contraditória não liberam conteúdo', async () => {
  const invalid = [
    { ...decision(), status: 'incomplete' },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'recusa' }] }] },
    { status: 'completed', output: [] },
    decision(true, 'privacy_credentials'), decision(false, 'permitted'), decision(true, 'desconhecido'),
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"allowed":true,"reason":"permitted","extra":"instrução"}' }] }] },
    new Response('não é JSON'), new Response('erro privado', { status: 503 }),
  ];
  for (const response of invalid) {
    const { client } = mock(native(), response);
    await assert.rejects(client.check('alô', { direction: 'output' }), { iaSafetyUnavailable: true });
  }
});

test('categoria nova marcada pela API é bloqueada até ser revisada', async () => {
  const { client } = mock(native({ 'new-risk': true }));
  assert.equal((await client.check('alô', { direction: 'output' })).allowed, false);
});
