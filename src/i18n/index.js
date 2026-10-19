// Idioma das respostas, escolhido pelo cargo do Discord: EU e NA recebem inglês, o resto português (pedido do
// usuário, 14/09/2026). Não é o idioma do app do Discord, que o bot nem enxerga numa mensagem de prefixo.
// Como adotar num comando: seção "Idioma por cargo" do CLAUDE.md.
import { idiomas as cargosPorIdioma } from '../../config/index.js';
import comum from './en/comum.js';
import perfil from './en/perfil.js';
import inatividade from './en/inatividade.js';

export const PADRAO = 'pt';

// A chave é a frase em português, então português não tem dicionário. Arquivo novo em en/ entra aqui.
export const TRADUCOES = {
  en: { ...comum, ...perfil, ...inatividade },
};

const LOCALES = { pt: 'pt-BR', en: 'en-US' };
export const IDIOMAS = Object.keys(LOCALES);

const avisados = new Set();
function avisarUmaVez(texto) {
  if (avisados.has(texto)) return;
  avisados.add(texto);
  console.warn(`[I18N] ${texto}`);
}

/** 'en' para quem tem um dos cargos de `idiomas` na config; 'pt' para o resto, inclusive sem membro (DM, quem saiu). */
export function idiomaDoMembro(member) {
  const roles = member?.roles;
  // GuildMember tem roles.cache; membro de interação fora do cache chega com a lista crua de IDs.
  const cargos = Array.isArray(roles) ? new Set(roles) : roles?.cache;
  if (!cargos) return PADRAO;

  const achado = Object.entries(cargosPorIdioma).find(([, ids]) => ids.some((id) => cargos.has(id)));
  return achado?.[0] ?? PADRAO;
}

const interpolar = (texto, variaveis) => String(texto).replace(/\{(\w+)\}/g, (marca, nome) => (variaveis[nome] ?? marca));

/**
 * `t(frase, variaveis)` no idioma de `origem`: a message (inclusive o shim do slash), a interaction, o
 * GuildMember ou 'pt'/'en' direto.
 *
 * `frase` é o texto em português, com `{variavel}` onde entra valor. Em português sai ela mesma; em inglês, a
 * tradução de i18n/en/. Frase sem tradução sai em português em vez de sumir da tela, e a checagem estática lista.
 */
export function tradutor(origem) {
  const pedido = typeof origem === 'string' ? origem : idiomaDoMembro(origem?.member ?? origem);
  const idioma = IDIOMAS.includes(pedido) ? pedido : PADRAO;
  const traducoes = TRADUCOES[idioma];

  const t = (frase, variaveis = {}) => {
    if (!traducoes) return interpolar(frase, variaveis);

    const traducao = traducoes[frase];
    if (traducao === undefined) {
      avisarUmaVez(`no '${idioma}' translation for "${frase}"`);
      return interpolar(frase, variaveis);
    }

    // Função é para plural que o português resolve com "(s)" e o inglês não.
    return typeof traducao === 'function' ? traducao(variaveis) : interpolar(traducao, variaveis);
  };

  t.idioma = idioma;
  t.numero = (n) => Number(n).toLocaleString(LOCALES[idioma]);
  return t;
}
