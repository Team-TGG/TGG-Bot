import test from 'node:test';
import assert from 'node:assert/strict';
import { createIaProvider } from '../src/services/iaProvider.js';

const tools = [{ name: 'ranking', description: 'Ranking', parameters: { type: 'OBJECT', properties: { ordem: { type: 'STRING', enum: ['maior', 'menor'] }, limite: { type: 'INTEGER' } } } }, { name: 'nao_sei_responder', parameters: { type: 'OBJECT', properties: {} } }];
const settings = { provedor: 'ollama', modelo: 'qwen3.5:4b', ollamaUrl: 'http://127.0.0.1:11435/', timeoutMs: 1000 };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const call = (name = 'ranking', args = { ordem: 'menor', limite: 5 }) => ({ message: { tool_calls: [{ function: { name, arguments: args } }] } });
const input = { pergunta: 'top 5', ferramentas: tools, instrucao: 'Escolha uma consulta.' };
function mock(...responses) {
  const requests = [];
  const client = createIaProvider(settings, { fetchImpl: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), signal: options.signal });
    assert.ok(responses.length, 'requisição inesperada');
    return json(responses.shift());
  } });
  return { client, requests };
}

test('Ollama configurado funciona sem chave do Gemini', () => {
  assert.equal(createIaProvider(settings).iaConfigurada(), true);
  assert.equal(createIaProvider({ ...settings, modelo: '' }).iaConfigurada(), false);
  assert.equal(createIaProvider({ provedor: 'gemini' }).iaConfigurada(), false);
  assert.equal(createIaProvider({ provedor: 'desconhecido', apiKey: 'offline' }).iaConfigurada(), false);
});

test('roteamento usa o modelo local sem streaming ou pensamento e converte schemas sem mutar catálogo', async () => {
  const { client, requests } = mock(call());
  const choice = await client.escolherFerramenta(input);
  assert.deepEqual(choice, { nome: 'ranking', args: { ordem: 'menor', limite: 5 }, assinatura: null });
  assert.equal(requests[0].url, 'http://127.0.0.1:11435/api/chat');
  assert.equal(requests[0].body.model, 'qwen3.5:4b');
  assert.equal(requests[0].body.stream, false);
  assert.equal(requests[0].body.think, false);
  assert.equal(requests[0].body.tools[0].function.parameters.type, 'object');
  assert.equal(requests[0].body.tools[0].function.parameters.properties.limite.type, 'integer');
  assert.equal(tools[0].parameters.type, 'OBJECT');
  assert.ok(requests[0].signal instanceof AbortSignal);
});

test('argumentos JSON serializados também são lidos e validados', async () => {
  const { client } = mock(call('ranking', '{"limite":5}'));
  assert.equal((await client.escolherFerramenta(input)).args.limite, 5);
});

test('modelo que responde em texto recebe uma segunda tentativa com saída estruturada', async () => {
  const { client, requests } = mock({ message: { content: 'Não escolhi.' } }, { message: { content: '{"nome":"ranking","args":{"limite":5}}' } });
  assert.equal((await client.escolherFerramenta(input)).nome, 'ranking');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body.format.oneOf.map(schema => schema.properties.nome.const), ['ranking', 'nao_sei_responder']);
});

test('múltiplas chamadas não executam múltiplas consultas', async () => {
  const { client, requests } = mock({ message: { tool_calls: [...call().message.tool_calls, ...call().message.tool_calls] } }, { message: { content: '{"nome":"nao_sei_responder","args":{}}' } });
  assert.equal((await client.escolherFerramenta(input)).nome, 'nao_sei_responder');
  assert.equal(requests.length, 2);
});

test('função inventada ou argumento inesperado nunca é aceito', async () => {
  for (const invalid of [call('executar_shell', {}), call('ranking', { comando: 'apagar' }), call('ranking', { limite: '5' }), call('ranking', { ordem: 'errada' })]) {
    const { client } = mock(invalid, { message: { content: '{"nome":"executar_shell","args":{}}' } });
    assert.equal(await client.escolherFerramenta(input), null);
  }
});

test('saída estruturada malformada continua sem executor em vez de inventar uma escolha', async () => {
  const { client } = mock({ message: {} }, { message: { content: 'não é JSON' } });
  assert.equal(await client.escolherFerramenta(input), null);
});

test('redação recebe dados reais como resultado de ferramenta, sem disponibilizar novas chamadas', async () => {
  const { client, requests } = mock({ message: { content: 'A luz revela 42 guild points.' } });
  const result = await client.redigirResposta({ pergunta: 'quanto?', escolha: { nome: 'ranking', args: {} }, resultado: { pontos: 42 }, instrucao: 'Lady Vera. Use somente os dados.' });
  assert.equal(result, 'A luz revela 42 guild points.');
  const body = requests[0].body;
  assert.equal(body.messages[0].content, 'Lady Vera. Use somente os dados.');
  assert.deepEqual(body.messages.map(message => message.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(body.messages[3].tool_name, 'ranking');
  assert.deepEqual(JSON.parse(body.messages[3].content), { pontos: 42 });
  assert.equal(body.tools, undefined);
  assert.equal(body.think, true);
  assert.equal(body.options.num_predict, 4096);
});

test('pensamento não aparece no texto enviado ao Discord', async () => {
  const { client } = mock({ message: { content: '<think>Rascunho interno</think> Apenas a resposta.' } });
  assert.equal(await client.redigirResposta({ escolha: { nome: 'ranking', args: {} }, resultado: {}, instrucao: '', pergunta: '' }), 'Apenas a resposta.');
});

test('conversa livre no Ollama não fabrica histórico de ferramenta', async () => {
  const { client, requests } = mock({ message: { content: 'A luz também ilumina uma boa conversa.' } });
  const text = await client.redigirResposta({ conversaLivre: true, pergunta: 'alô', instrucao: 'Converse como Lady Vera.' });
  assert.match(text, /boa conversa/);
  assert.deepEqual(requests[0].body.messages.map(message => message.role), ['system', 'user']);
  assert.equal(requests[0].body.messages[1].content, 'alô');
});

test('conversa livre no Gemini também dispensa chamada e assinatura', async () => {
  let body;
  const client = createIaProvider({ provedor: 'gemini', modelo: 'offline', apiKey: 'offline', timeoutMs: 1000 }, { fetchImpl: async (url, options) => { body = JSON.parse(options.body); return json({ candidates: [{ content: { parts: [{ text: 'Olá.' }] } }] }); } });
  assert.equal(await client.redigirResposta({ conversaLivre: true, pergunta: 'alô', instrucao: 'Converse.' }), 'Olá.');
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'alô' }] }]);
});

test('PC desconectado produz erro útil sem tentar Gemini', async () => {
  let calls = 0;
  const client = createIaProvider(settings, { fetchImpl: async () => { calls++; throw new Error('ECONNREFUSED'); } });
  await assert.rejects(client.escolherFerramenta(input), error => error.iaLocalIndisponivel && /PC, o Ollama e a conexão/.test(error.message));
  assert.equal(calls, 1);
});

test('corpo de erro do provedor não vaza para o usuário', async () => {
  const client = createIaProvider(settings, { fetchImpl: async () => new Response('prompt privado', { status: 500 }) });
  await assert.rejects(client.escolherFerramenta(input), error => error.message === 'Ollama respondeu HTTP 500.');
});

test('Gemini preserva ferramenta forçada e assinatura entre os dois turnos', async () => {
  const requests = [];
  const responses = [{ candidates: [{ content: { parts: [{ functionCall: { name: 'ranking', args: { limite: 5 } }, thoughtSignature: 'assinatura' }] } }] }, { candidates: [{ content: { parts: [{ text: 'Resposta compatível.' }] } }] }];
  const client = createIaProvider({ provedor: 'gemini', modelo: 'modelo-offline', apiKey: 'offline', timeoutMs: 1000 }, { fetchImpl: async (url, options) => { requests.push(JSON.parse(options.body)); return json(responses.shift()); } });
  const choice = await client.escolherFerramenta(input);
  assert.equal(choice.assinatura, 'assinatura');
  assert.equal(requests[0].tool_config.function_calling_config.mode, 'ANY');
  assert.equal(await client.redigirResposta({ pergunta: 'top 5', escolha: choice, resultado: { pontos: 5 }, instrucao: 'responda' }), 'Resposta compatível.');
  assert.equal(requests[1].contents[1].parts[0].thoughtSignature, 'assinatura');
});
