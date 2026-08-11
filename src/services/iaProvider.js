import { ia as config } from '../../config/index.js';

/**
 * Cliente da API do Gemini — a única parte do `.ia` que sabe qual provedor de IA está em uso.
 * Trocar de provedor (Groq, OpenRouter, Claude) é reescrever este arquivo e mais nada: o catálogo
 * de ferramentas e a montagem do embed ficam em [iaHandlers.js](../handlers/iaHandlers.js).
 *
 * **A IA não calcula nada.** Ela faz duas coisas: escolhe qual função do bot responde a pergunta
 * (`escolherFerramenta`) e escreve a frase em português a partir do resultado (`redigirResposta`).
 * Os números saem do mesmo código que decide o MVP e a inativação na quarta-feira — se a IA
 * somasse por conta própria, o `.ia` daria um número que discorda do cron, que é exatamente o que
 * [contribuicaoSemanal.js](./contribuicaoSemanal.js) existe para evitar.
 *
 * Escolhido pelo free tier: o AI Studio libera um volume diário que este bot não chega perto de
 * gastar, e a rota é um POST com `fetch` — sem dependência nova.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Se está configurado. Sem chave o comando avisa que está desligado; o resto do bot não muda. */
export function iaConfigurada() {
  return Boolean(config.apiKey);
}

async function chamar(body) {
  const url = `${ENDPOINT}/${config.modelo}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!resposta.ok) {
    // O corpo do erro do Gemini diz se é cota, chave inválida ou schema recusado - vale no log
    const detalhe = await resposta.text().catch(() => '');
    throw new Error(`Gemini respondeu ${resposta.status}: ${detalhe.slice(0, 300)}`);
  }

  return resposta.json();
}

function partesDaResposta(dados) {
  return dados?.candidates?.[0]?.content?.parts ?? [];
}

/**
 * Traduz a pergunta em uma chamada de função. Devolve `null` quando o modelo não escolheu nada —
 * quem chama trata isso como "não entendi", nunca como erro.
 *
 * `mode: 'ANY'` obriga o modelo a escolher uma ferramenta em vez de responder de cabeça. Sem isso
 * ele às vezes devolve texto inventado sobre a guilda, que é o pior resultado possível aqui.
 */
export async function escolherFerramenta({ pergunta, ferramentas, instrucao }) {
  const dados = await chamar({
    system_instruction: { parts: [{ text: instrucao }] },
    contents: [{ role: 'user', parts: [{ text: pergunta }] }],
    tools: [{ function_declarations: ferramentas }],
    tool_config: { function_calling_config: { mode: 'ANY' } },
  });

  const parte = partesDaResposta(dados).find(p => p.functionCall);

  if (!parte?.functionCall?.name) return null;

  // `assinatura` só existe para ser devolvida em `redigirResposta` - ver o comentário de lá.
  return {
    nome: parte.functionCall.name,
    args: parte.functionCall.args ?? {},
    assinatura: parte.thoughtSignature ?? null,
  };
}

/**
 * Escreve a resposta em português a partir do resultado da ferramenta.
 *
 * O `contents` reconstrói o turno inteiro (pergunta → chamada → resultado) porque a API é sem
 * estado. `functionResponse.response` precisa ser objeto, nunca array.
 *
 * O `thoughtSignature` que veio na primeira chamada tem que voltar junto do `functionCall`: sem ele
 * os modelos Gemini 3 recusam o turno reconstruído com **400** (`Function call is missing a
 * thought_signature`) e a resposta nunca é escrita — como o erro cai no `.catch` de quem chama, o
 * comando continua respondendo com os dados e a falha passa despercebida. Medido em 11/08/2026 no
 * `gemini-3.5-flash-lite`. Mandar o resultado como texto simples também contorna o 400, mas aí o
 * modelo perde o contexto da ferramenta e inventa a unidade (chamou guild points de "XP" no teste).
 */
export async function redigirResposta({ pergunta, escolha, resultado, instrucao }) {
  const chamadaDoModelo = { functionCall: { name: escolha.nome, args: escolha.args } };

  if (escolha.assinatura) chamadaDoModelo.thoughtSignature = escolha.assinatura;

  const dados = await chamar({
    system_instruction: { parts: [{ text: instrucao }] },
    contents: [
      { role: 'user', parts: [{ text: pergunta }] },
      { role: 'model', parts: [chamadaDoModelo] },
      { role: 'user', parts: [{ functionResponse: { name: escolha.nome, response: resultado } }] },
    ],
  });

  return partesDaResposta(dados)
    .map(p => p.text)
    .filter(Boolean)
    .join('')
    .trim();
}
