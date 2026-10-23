// dailyAliases.js - aliases do .daily compradas na loja (tabela tgg_coins_daily_aliases)
import { getClient } from './db.js';

// Recebido do index.js no boot: importar commands.js daqui fecha um ciclo com tggCoinsHandlers
// (commands → tggCoinsCommands → tggCoinsHandlers → commands) e o bot nem sobe
let COMANDOS = {};
export function definirComandosExistentes(aliases) {
  COMANDOS = aliases;
}

export function ehComandoExistente(palavra) {
  return Boolean(COMANDOS[palavra]);
}

// Uma mensagem do Discord tem até 2000 caracteres e o ponto do prefixo ocupa um
export const TAMANHO_MAXIMO_ALIAS = 1999;

// Cache em memória: o messageCreate consulta a cada comando e não pode esperar o banco
let ALIASES = new Map();

export async function carregarAliasesDoDaily() {
  const { data, error } = await getClient()
    .from('tgg_coins_daily_aliases')
    .select('alias, discord_id, nome');

  // Sem a tabela o bot segue só com as aliases do código; não derruba a inicialização
  if (error) {
    console.error('[Daily Aliases] Falha ao carregar:', error.message);
    return;
  }

  ALIASES = new Map(data.map(row => [row.alias, row]));
  console.log(`[Daily Aliases] ${ALIASES.size} carregadas`);
}

export function ehAliasDoDaily(palavra) {
  return ALIASES.has(palavra);
}

// Mesma normalização do index.js: primeira palavra, em minúsculas, sem o ponto
export function normalizarAlias(texto) {
  return texto.trim().replace(/^\.+/, '').toLowerCase();
}

// null quando a alias pode ser usada; senão, o motivo para mostrar a quem comprou
export function motivoAliasInvalida(alias) {
  if (!alias) return 'A alias não pode ser vazia.';
  if (/\s/.test(alias)) return 'A alias não pode ter espaço: o bot só lê a primeira palavra depois do ponto. Use `-` no lugar.';
  if (alias.includes('`')) return 'A alias não pode ter crase (`` ` ``).';
  if (alias.length > TAMANHO_MAXIMO_ALIAS) return `A alias pode ter no máximo ${TAMANHO_MAXIMO_ALIAS} caracteres.`;
  if (COMANDOS[alias] || ALIASES.has(alias)) return `\`.${alias}\` já existe. Escolha outra.`;
  return null;
}

/**
 * Grava a alias. A chave primária barra duas compras simultâneas da mesma palavra:
 * quem perder a corrida recebe JA_EXISTE e não é cobrado.
 */
export async function registrarAliasDoDaily(alias, discordId, nome) {
  const { error } = await getClient()
    .from('tgg_coins_daily_aliases')
    .insert({ alias, discord_id: String(discordId), nome });

  if (error) {
    if (error.code === '23505') return 'JA_EXISTE';
    throw error;
  }

  ALIASES.set(alias, { alias, discord_id: String(discordId), nome });
  return 'OK';
}
