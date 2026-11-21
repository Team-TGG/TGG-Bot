import { ia as config } from '../../config/index.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);

/** O catálogo continua independente do provedor; a IA seleciona consultas, não calcula os dados. */
export function createIaProvider(settings, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const provider = settings.provedor || 'gemini';
  const ollama = provider === 'ollama';
  const configured = () => ollama
    ? Boolean(settings.modelo && settings.ollamaUrl && /^https?:\/\//.test(settings.ollamaUrl))
    : provider === 'gemini' && Boolean(settings.apiKey);

  async function post(url, body) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(settings.timeoutMs),
      });
    } catch (cause) {
      const error = new Error(ollama
        ? 'Ollama local indisponível. Confira se o PC, o Ollama e a conexão com a VPS estão ativos.'
        : 'Não foi possível consultar o serviço de IA.', { cause });
      if (ollama) error.iaLocalIndisponivel = true;
      throw error;
    }
    if (!response.ok) {
      // Não repassar corpo ou URL autenticada para mensagens do Discord.
      await response.body?.cancel().catch(() => {});
      throw new Error(`${ollama ? 'Ollama' : 'Gemini'} respondeu HTTP ${response.status}.`);
    }
    try { return await response.json(); }
    catch { throw new Error('O serviço de IA retornou uma resposta inválida.'); }
  }

  const gemini = body => post(`${GEMINI_ENDPOINT}/${settings.modelo}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, body);
  const chat = body => post(`${settings.ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
    model: settings.modelo, stream: false, think: false, keep_alive: '10m',
    options: { temperature: 0, num_ctx: 8192, num_predict: 512 }, ...body,
  });
  const parts = data => data?.candidates?.[0]?.content?.parts ?? [];

  // Gemini descreve os tipos em maiúsculas; Ollama recebe JSON Schema padrão.
  function schemaForOllama(value) {
    if (Array.isArray(value)) return value.map(schemaForOllama);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      key === 'type' && typeof item === 'string' ? item.toLowerCase() : schemaForOllama(item),
    ]));
  }

  function validArgs(args, schema) {
    if (!object(args)) return false;
    const properties = schema?.properties || {};
    if ((schema?.required || []).some(key => args[key] == null)) return false;
    return Object.entries(args).every(([key, value]) => {
      if (!Object.hasOwn(properties, key)) return false;
      const rule = properties[key];
      if (value == null && !(schema?.required || []).includes(key)) return true;
      const type = rule.type?.toLowerCase();
      if (type === 'string' && typeof value !== 'string') return false;
      if (type === 'integer' && !Number.isSafeInteger(value)) return false;
      if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
      if (type === 'boolean' && typeof value !== 'boolean') return false;
      if (rule.enum && !rule.enum.includes(value)) return false;
      return true;
    });
  }

  function normalizeChoice(name, args, tools) {
    const tool = tools.find(item => item.name === name);
    if (!tool) return null;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return null; } }
    args ??= {};
    if (!validArgs(args, tool.parameters)) return null;
    return { nome: name, args: Object.fromEntries(Object.entries(args).filter(([, value]) => value != null)), assinatura: null };
  }

  async function escolherFerramenta({ pergunta, ferramentas, instrucao }) {
    if (!ollama) {
      const data = await gemini({
        system_instruction: { parts: [{ text: instrucao }] },
        contents: [{ role: 'user', parts: [{ text: pergunta }] }],
        tools: [{ function_declarations: ferramentas }],
        tool_config: { function_calling_config: { mode: 'ANY' } },
      });
      const part = parts(data).find(item => item.functionCall);
      if (!part?.functionCall?.name) return null;
      return { nome: part.functionCall.name, args: part.functionCall.args ?? {}, assinatura: part.thoughtSignature ?? null };
    }
    const messages = [
      { role: 'system', content: `${instrucao} Retorne exatamente uma chamada de função. Não responda à pergunta em texto.` },
      { role: 'user', content: pergunta },
    ];
    const data = await chat({
      messages,
      tools: ferramentas.map(tool => ({ type: 'function', function: { ...tool, parameters: schemaForOllama(tool.parameters) } })),
    });
    const calls = data?.message?.tool_calls;
    if (Array.isArray(calls) && calls.length === 1) {
      const choice = normalizeChoice(calls[0].function?.name, calls[0].function?.arguments, ferramentas);
      if (choice) return choice;
    }
    // O Ollama não força tool_choice=ANY: uma saída estruturada garante uma única escolha válida.
    const format = { oneOf: ferramentas.map(tool => ({
      type: 'object', properties: {
        nome: { type: 'string', const: tool.name },
        args: { ...schemaForOllama(tool.parameters), additionalProperties: false },
      }, required: ['nome', 'args'], additionalProperties: false,
    })) };
    const retry = await chat({
      messages: [
        { role: 'system', content: `${instrucao}\nEscolha uma função do catálogo e responda apenas com JSON no formato {"nome":"funcao","args":{}}.\nCatálogo: ${JSON.stringify(ferramentas)}` },
        { role: 'user', content: pergunta },
      ], format,
    });
    try {
      const choice = JSON.parse(retry?.message?.content || '');
      return normalizeChoice(choice.nome, choice.args, ferramentas);
    } catch { return null; }
  }

  async function redigirResposta({ pergunta, escolha, resultado, instrucao, conversaLivre = false }) {
    if (ollama) {
      const data = await chat({ think: true, options: { temperature: 0, num_ctx: 8192, num_predict: 4096 }, messages: [
        { role: 'system', content: instrucao },
        { role: 'user', content: pergunta },
        ...(conversaLivre ? [] : [
          { role: 'assistant', content: '', tool_calls: [{ function: { name: escolha.nome, arguments: escolha.args } }] },
          { role: 'tool', tool_name: escolha.nome, content: JSON.stringify(resultado) },
        ]),
      ] });
      return String(data?.message?.content || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
    }
    const call = conversaLivre ? null : { functionCall: { name: escolha.nome, args: escolha.args } };
    // Gemini 3 exige reenviar a assinatura do turno original.
    if (!conversaLivre && escolha.assinatura) call.thoughtSignature = escolha.assinatura;
    const data = await gemini({
      system_instruction: { parts: [{ text: instrucao }] },
      contents: conversaLivre ? [{ role: 'user', parts: [{ text: pergunta }] }] : [
        { role: 'user', parts: [{ text: pergunta }] },
        { role: 'model', parts: [call] },
        { role: 'user', parts: [{ functionResponse: { name: escolha.nome, response: resultado } }] },
      ],
    });
    return parts(data).map(part => part.text).filter(Boolean).join('').trim();
  }
  return { iaConfigurada: configured, escolherFerramenta, redigirResposta };
}

const client = createIaProvider(config);
export const iaConfigurada = (...args) => client.iaConfigurada(...args);
export const escolherFerramenta = (...args) => client.escolherFerramenta(...args);
export const redigirResposta = (...args) => client.redigirResposta(...args);
