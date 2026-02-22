/**
 * Guild Movimentacao API: fetch movement logs with date ranges and display as embeds.
 */

import { EmbedBuilder } from 'discord.js';
import { movimentacao as config } from '../config/index.js';

/**
 * Build the API URL with query parameters
 * @param {string} startDate - YYYY-MM-DD format (optional, defaults to 7 days ago)
 * @param {string} endDate - YYYY-MM-DD format (optional, defaults to today)
 * @param {number} limit - Max records (default 5000, max 5000)
 * @returns {string}
 */
function buildMovimentacaoUrl(startDate = null, endDate = null, limit = 5000) {
  if (!config.url || !config.key) return null;
  
  const u = new URL(config.url);
  
  if (startDate) u.searchParams.set('start', startDate);
  if (endDate) u.searchParams.set('end', endDate);
  if (limit) u.searchParams.set('limit', Math.min(limit, 5000));
  
  return u.toString();
}

/**
 * Fetch guild movimentacao data from API
 * @param {string} startDate - YYYY-MM-DD format (optional)
 * @param {string} endDate - YYYY-MM-DD format (optional)
 * @param {number} limit - Max records (default 5000)
 * @returns {Promise<{ ok: boolean, data?: array, message?: string }>}
 */
export async function fetchMovimentacao(startDate = null, endDate = null, limit = 5000) {
  const url = buildMovimentacaoUrl(startDate, endDate, limit);
  if (!url) {
    throw new Error('TGG_MOVIMENTACAO_URL and TGG_MOVIMENTACAO_API_KEY must be set in .env');
  }

  console.log('[Movimentacao] Fetching from:', url);
  console.log('[Movimentacao] Using API Key:', config.key ? '✓ Present' : '✗ Missing');

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': config.key,
    },
  });

  console.log('[Movimentacao] Response status:', res.status);
  
  const data = await res.json().catch(() => null);
  
  if (!res.ok || !data) {
    console.error('[Movimentacao] Error:', data);
    throw new Error(data?.message || `API returned ${res.status}`);
  }

  // Handle API response structure: movimentacao.registros contains the records
  let records = [];
  if (data.movimentacao && data.movimentacao.registros) {
    // registros might be an object with error data or an array
    const registros = data.movimentacao.registros;
    if (Array.isArray(registros)) {
      records = registros;
    } else if (registros && !registros.code && !registros.message) {
      // If it's not an array and not an error object, convert to array
      records = [registros];
    }
    // If it has code/message, it's an error object; skip it (records remains [])
  } else if (data.data && Array.isArray(data.data)) {
    // Fallback for other response structures
    records = data.data;
  }

  return {
    ok: data.success !== false,
    data: records,
    resumo: data.resumo || {},
    periodo: data.periodo || {},
  };
}

/**
 * Build Discord embeds from movimentacao data
 * @param {array} records - Movement records
 * @param {string} startDate
 * @param {string} endDate
 * @returns {EmbedBuilder[]}
 */
export function buildMovimentacaoEmbeds(records, startDate, endDate) {
  const embeds = [];
  
  // Custom emoji IDs
  const EMOJIS = {
    entrou: '<:icon_v:825250296987910144>',
    saiu: '<:icon_x:872277999687442472>',
    promovido: '<:icon_up:1471913779280351316>',
    rebaixado: '<:icon_down:1471913822280355921>',
    time: '<:time2:1406766019589967924>',
    seta: '<a:seta:851206127471034378>',
    ponto: '<:g_ponto_white_RR:1305837905624698880>',
  };

  if (!records || records.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle(`${EMOJIS.ponto} Guild Movimentação`)
        .setDescription('Nenhum registro encontrado no período especificado.')
        .setFooter({ text: `${EMOJIS.time} Período: ${startDate || 'N/A'} a ${endDate || 'N/A'}` }),
    ];
  }

  // Filter out error records (check for 'code' and 'message' properties)
  const validRecords = Array.isArray(records)
    ? records.filter((r) => !r.code && !r.message)
    : [];

  if (validRecords.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle(`${EMOJIS.ponto} Guild Movimentação`)
        .setDescription('Nenhum registro encontrado no período especificado.')
        .setFooter({ text: `${EMOJIS.time} Período: ${startDate || 'N/A'} a ${endDate || 'N/A'}` }),
    ];
  }

  // Group records by action type
  const groupedByAction = {};
  validRecords.forEach((record) => {
    const action = record.action || 'unknown';
    if (!groupedByAction[action]) groupedByAction[action] = [];
    groupedByAction[action].push(record);
  });

  const actionColors = {
    entrou: 0x57f287,
    saiu: 0xed4245,
    promovido: 0xfee75c,
    rebaixado: 0xd946ef,
    unknown: 0x95a5a6,
  };

  // Build embed for each action type
  Object.entries(groupedByAction).forEach(([action, items]) => {
    const color = actionColors[action] || 0x95a5a6;
    const emoji = EMOJIS[action] || EMOJIS.ponto;
    const actionLabel = {
      entrou: 'Entradas',
      saiu: 'Saídas',
      promovido: 'Promoções',
      rebaixado: 'Rebaixamentos',
    }[action] || action;

    const description = items
      .map((item) => {
        const name = item.player_name || item.nome || 'Unknown';
        const rank = item.rank || item.new_rank || 'N/A';
        const date = item.occurred_at || item.timestamp || '';
        return `${EMOJIS.ponto} **${name}** ${EMOJIS.seta} ${rank} ${date ? `(${EMOJIS.time} ${date})` : ''}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${emoji} ${actionLabel} — ${items.length} registros`)
      .setDescription(description.slice(0, 4096)) // Discord embed limit
      .setFooter({ text: `${EMOJIS.time} Período: ${startDate || 'N/A'} a ${endDate || 'N/A'}` });

    embeds.push(embed);
  });

  return embeds;
}

/**
 * Get default date range (last 7 days)
 * @returns {{ startDate: string, endDate: string }}
 */
export function getDefaultDateRange() {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

/**
 * Format date string for validation (YYYY-MM-DD)
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDate(dateStr) {
  if (!dateStr) return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date);
}
