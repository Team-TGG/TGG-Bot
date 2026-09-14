// Filtro da mensagem do .profile: link e palavrão. Bloqueia em vez de trocar por asterisco, para quem
// escreveu saber o que mudar; o que escapar continua saindo pelo `.limpar-perfil` da staff.

const LINKS = [
  /https?:\/\//i,
  /\bwww\./i,
  /discord(app)?\.com\/invite/i,
  // Domínio sem protocolo ("meusite.com.br"). Só terminação comum, senão "ok.tchau" viraria link.
  /\b[a-z0-9-]+\.(com|net|org|br|gg|io|me|tv|xyz|ly|co|app|dev|link|site|online|store|shop|info|live|club|fun|pro|us|to)\b/i,
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };

/* Sem acento, sem leet e sem letra repetida: "PÖRRAAA", "p0rra" e "porra" viram a mesma palavra. As
   listas passam pela mesma normalização, então "arrombado" é guardado como "arombado". */
function normalizar(texto) {
  return texto
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134578@$]/g, (c) => LEET[c])
    .replace(/(\p{L})\1+/gu, '$1');
}

// Palavra inteira: "cu" não pode bloquear "cuidado", nem "puta" bloquear "computador". "Pica" e "rola" ficam de
// fora de propósito: no chat da guilda são "é muito bom" e "acontece" bem mais do que palavrão.
const EXATAS = new Set([
  'cu', 'cus', 'cuzao', 'fdp', 'pqp', 'vsf', 'tnc', 'krl', 'crl', 'porra', 'puta', 'putas', 'puto', 'putos',
  'putinha', 'putaria', 'merda', 'bosta', 'buceta', 'xota', 'xoxota', 'xereca', 'piroca',
  'corno', 'cornos', 'viado', 'viados', 'viadinho', 'viadagem', 'boiola', 'baitola', 'traveco', 'vadia',
  'vagabunda', 'retardado', 'retardada',
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'whore',
  'slut', 'nigger', 'nigga', 'faggot', 'fag', 'retard',
].map(normalizar));

// Começo de palavra, para as flexões ("caralhada", "fodase", "arrombada"). Só raiz que não começa palavra comum.
const RAIZES = [
  'caralh', 'arromb', 'foda', 'fode', 'fodi', 'fude', 'fudi', 'punhet', 'siriric', 'bucet', 'merdinh', 'fuck',
  'bitch', 'nigg', 'boiol',
].map(normalizar);

function palavras(texto) {
  const tokens = normalizar(texto).split(/[^\p{L}]+/u).filter(Boolean);
  const saida = [...tokens];

  // "p u t a" e "p.u.t.a": sequência de letras soltas também vira uma palavra.
  let soltas = '';
  for (const token of [...tokens, '']) {
    if (token.length === 1) {
      soltas += token;
      continue;
    }
    if (soltas.length > 1) saida.push(soltas.replace(/(\p{L})\1+/gu, '$1'));
    soltas = '';
  }

  return saida;
}

/** `'link'`, `'palavrao'` ou `null` se o texto pode ser salvo. */
export function motivoDeBloqueio(texto) {
  if (LINKS.some((padrao) => padrao.test(texto))) return 'link';
  if (palavras(texto).some((p) => EXATAS.has(p) || RAIZES.some((raiz) => p.startsWith(raiz)))) return 'palavrao';
  return null;
}
