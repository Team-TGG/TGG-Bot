import { EmbedBuilder } from 'discord.js';
import { movimentacao as config } from '../config/index.js';

function buildMovimentacaoUrl(options = {}) {
  if (!config.baseUrl || !config.endpoint) return null;
  
  let {
    date = null,
    startDate = null,
    endDate = null,
    action = null,
    search = null,
    limit = 5000,
  } = options;
  
  if (!date && !startDate && !endDate) {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    startDate = sevenDaysAgo.toISOString().split('T')[0];
    endDate = now.toISOString().split('T')[0];
  }
  
  const u = new URL(config.baseUrl);
  u.pathname = config.endpoint;
  
  if (date) {
    u.searchParams.set('date', date);
  } else {
    if (startDate) u.searchParams.set('start', startDate);
    if (endDate) u.searchParams.set('end', endDate);
  }
  
  if (action) u.searchParams.set('action', action);
  if (search) u.searchParams.set('search', search);
  if (limit) u.searchParams.set('limit', Math.min(limit, 5000));
  
  return u.toString();
}


export async function fetchMovimentacao(options = {}) {
  const queryOptions = typeof options === 'string' 
    ? { startDate: options, endDate: arguments[1], limit: arguments[2] }
    : options;
    
  const url = buildMovimentacaoUrl(queryOptions);
  if (!url || !config.apiKey) {
    throw new Error('TGG_API_URL, TGG_MOVIMENTACAO_ENDPOINT, and TGG_API_KEY must be set in .env');
  }

  console.log('[Movimentacao] Fetching from:', url);
  console.log('[Movimentacao] API Key present:', !!config.apiKey, `(${config.apiKey?.length} chars)`);
  
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Accept': 'application/json',
  };
  
  console.log('[Movimentacao] Headers:', { ...headers, 'Authorization': headers.Authorization.substring(0, 20) + '...' });

  const res = await fetch(url, {
    method: 'GET',
    headers,
  });

  console.log('[Movimentacao] Response status:', res.status);
  
  const data = await res.json().catch(() => null);
  
  if (!res.ok || !data) {
    console.error('[Movimentacao] Error:', data);
    console.error('[Movimentacao] Response text:', await res.text().catch(() => 'N/A'));
    throw new Error(data?.message || `API returned ${res.status}`);
  }

  if (!data.success) {
    throw new Error(data?.error || 'API returned unsuccessful response');
  }

  let records = Array.isArray(data.data) ? data.data : [];
  
  records = records.map(record => ({
    id: record.id,
    brawlhalla_id: record.brawlhalla_id || record.brawlhallaid,
    nome: record.nome || record.player_name,
    rank: record.rank || record.new_rank,
    action: record.action,
    occurred_at: record.occurred_at || record.timestamp,
  }));

  return {
    ok: true,
    data: records,
    summary: data.summary || {},
  };
}

function calculateEmbedSize(embed) {
  let size = 0;
  if (embed.data.title) size += embed.data.title.length;
  if (embed.data.description) size += embed.data.description.length;
  if (embed.data.footer?.text) size += embed.data.footer.text.length;
  if (embed.data.fields) {
    embed.data.fields.forEach(f => {
      size += (f.name?.length || 0) + (f.value?.length || 0);
    });
  }
  return size;
}

export function buildMovimentacaoEmbeds(records, startDate, endDate) {
  const EMOJIS = {
    entrou: '<:check:1475806856722120838>',
    saiu: '<:xis:1475807109554896966>',
    promovido: '<:cima:1475807892782317578>',
    rebaixado: '<:baixo:1475807866714718239>',
    time: '<:clock:1475829939122212874>',
    loading: '<a:loading:1475806256366358633>',
    seta: '<:arrowright:1475806826833383456>',
    ponto: '<:symboldash:1475807293323870238>',
  };

  if (!records || records.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle(`${EMOJIS.ponto} Guild Movimentação`)
          .setDescription('Nenhum registro encontrado no período especificado.')
          .setFooter({ text: `Período: ${startDate || 'N/A'} a ${endDate || 'N/A'}` }),
      ],
      needsFile: false,
      json: { data: [], summary: {} },
    };
  }

 
  const validRecords = Array.isArray(records)
    ? records.filter((r) => {
        return r && r.nome && r.action && !r.code && !r.message && r.action !== 'error';
      })
    : [];

  if (validRecords.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle(`${EMOJIS.ponto} Guild Movimentação`)
          .setDescription('Nenhum registro encontrado no período especificado.')
          .setFooter({ text: `Período: ${startDate || 'N/A'} a ${endDate || 'N/A'}` }),
      ],
      needsFile: false,
      json: { data: [], summary: {} },
    };
  }

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

 
  Object.entries(groupedByAction).forEach(([action, items]) => {
    const color = actionColors[action] || 0x95a5a6;
    const emoji = EMOJIS[action] || EMOJIS.ponto;
    const actionLabel = {
      entrou: 'Entradas',
      saiu: 'Saídas',
      promovido: 'Promoções',
      rebaixado: 'Rebaixamentos',
    }[action] || action;

   
    const itemsPerEmbed = 50; 
    const itemChunks = [];
    for (let i = 0; i < items.length; i += itemsPerEmbed) {
      itemChunks.push(items.slice(i, i + itemsPerEmbed));
    }

    itemChunks.forEach((chunk, chunkIndex) => {
      const description = chunk
        .map((item) => {
          const name = item.nome || 'Unknown';
          const rank = item.rank || 'N/A';
          const date = item.occurred_at || '';
          return `${EMOJIS.ponto} **${name}** ${EMOJIS.seta} ${rank} ${date ? `(${EMOJIS.time} ${date})` : ''}`;
        })
        .join('\n');

      const chunkLabel = itemChunks.length > 1 ? `${actionLabel} (${chunkIndex + 1}/${itemChunks.length})` : actionLabel;
      const dateDisplay = startDate === endDate ? startDate : `${startDate} a ${endDate}`;
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} ${chunkLabel} — ${chunk.length} registros`)
        .setDescription(description.slice(0, 4096)) // Discord embed limit
        .setFooter({ text: `Período: ${dateDisplay}` });

      embeds.push(embed);
    });
  });

  let totalSize = 0;
  let needsFile = false;
  embeds.forEach(embed => {
    totalSize += calculateEmbedSize(embed);
  });

  if (totalSize > 5500 || embeds.length > 10) {
    needsFile = true;
  }

  return {
    embeds: needsFile ? [] : embeds,
    needsFile,
    json: {
      period: { start: startDate, end: endDate },
      summary: {
        entrou: groupedByAction.entrou?.length || 0,
        saiu: groupedByAction.saiu?.length || 0,
        promovido: groupedByAction.promovido?.length || 0,
        rebaixado: groupedByAction.rebaixado?.length || 0,
        total: validRecords.length,
      },
      data: groupedByAction,
    },
  };
}

export function getDefaultDateRange() {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

export function isValidDate(dateStr) {
  if (!dateStr) return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date);
}

export async function fetchMovimentacaoByDate(date) {
  return fetchMovimentacao({ date });
}

export async function fetchMovimentacaoByDateRange(startDate, endDate) {
  return fetchMovimentacao({ startDate, endDate });
}

export async function fetchMovimentacaoByAction(action, date = null) {
  return fetchMovimentacao({ date, action });
}

export async function fetchMovimentacaoBySearch(playerName, date = null) {
  return fetchMovimentacao({ date, search: playerName });
}

export function formatMovimentacaoAsText(json) {
  if (!json || !json.data) return '';

  const { period, summary, data } = json;
  let text = '';

  text += `═══════════════════════════════════════════\n`;
  text += `GUILD MOVIMENTAÇÃO - ${period.start} a ${period.end}\n`;
  text += `═══════════════════════════════════════════\n\n`;

  // Summary
  text += `RESUMO:\n`;
  text += `├─ Entradas: ${summary.entrou}\n`;
  text += `├─ Saídas: ${summary.saiu}\n`;
  text += `├─ Promoções: ${summary.promovido}\n`;
  text += `├─ Rebaixamentos: ${summary.rebaixado}\n`;
  text += `└─ Total: ${summary.total}\n\n`;

  // Detailed records by action
  const actionLabels = {
    entrou: 'ENTRADAS',
    saiu: 'SAÍDAS',
    promovido: 'PROMOÇÕES',
    rebaixado: 'REBAIXAMENTOS',
  };

  Object.entries(actionLabels).forEach(([action, label]) => {
    if (data[action] && Array.isArray(data[action]) && data[action].length > 0) {
      text += `───────────────────────────────────────────\n`;
      text += `${label} (${data[action].length})\n`;
      text += `───────────────────────────────────────────\n`;

      data[action].forEach((record, idx) => {
        const num = String(idx + 1).padStart(3, ' ');
        const name = record.nome || 'Unknown';
        const rank = record.rank || 'N/A';
        const date = record.occurred_at || '';
        text += `${num}. ${name} -> Rank: ${rank} (${date})\n`;
      });

      text += '\n';
    }
  });

  return text;
}
