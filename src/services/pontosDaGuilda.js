export function pontosValidos(valor) {
  if (!['number', 'string'].includes(typeof valor) || (typeof valor === 'string' && !valor.trim())) return null;
  const pontos = Number(valor);
  return Number.isSafeInteger(pontos) && pontos >= 0 ? pontos : null;
}

/** O total de /v1/guild/stats já pertence à semana corrente (contrato da API). */
export const pontosSemanaisDaGuilda = pontosValidos;
