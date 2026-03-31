

import { EmbedBuilder } from 'discord.js';
import { guildActivity as config } from '../config/index.js';

const ACTIVITY_URL = () => {
  if (!config.baseUrl || !config.endpoint) return null;
  return `${config.baseUrl}${config.endpoint}`;
};


export async function runGuildActivitySync() {
  const url = ACTIVITY_URL();
  if (!url || !config.apiKey) {
    throw new Error('TGG_API_URL, TGG_GUILD_REPORT_ENDPOINT, and TGG_API_KEY must be set in .env');
  }

  console.log('[GuildActivity] Fetching from:', url);
  console.log('[GuildActivity] API Key present:', !!config.apiKey, `(${config.apiKey?.length} chars)`);
  
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Accept': 'application/json',
  };
  
  console.log('[GuildActivity] Headers:', { ...headers, 'Authorization': headers.Authorization.substring(0, 20) + '...' });
  
  const res = await fetch(url, {
    method: 'GET',
    headers,
  });

  console.log('[GuildActivity] Response status:', res.status);
  
  const data = await res.json().catch(() => null);
  
  if (!res.ok || !data) {
    console.error('[GuildActivity] Error response:', data);
    console.error('[GuildActivity] Response text:', await res.text().catch(() => 'N/A'));
    throw new Error(data?.message || `API returned ${res.status}`);
  }

  if (!data.success) {
    throw new Error(data?.error || 'API returned unsuccessful response');
  }

  console.log('[GuildActivity] Success - fetched guild report with latest activity');
  
  return data;
}


export function buildEmbedsFromGuildActivity(data) {
  const embeds = [];
  
  // Emojis Unicode (funcionam em qualquer lugar)
  const EMOJIS = {
    entrou: '✅',
    saiu: '❌',
    promovido: '⬆️',
    rebaixado: '⬇️',
    info: 'ℹ️',
    time: '🕐',
    seta: '➡️',
    ponto: '•',
  };


  if (!data || !data.data) {
    return [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle(`${EMOJIS.info} Sincronização da Guild`)
        .setDescription('Nenhuma alteração detectada.')
        .setTimestamp(),
    ];
  }

  const reportData = data.data;
  const timestamp = reportData.timestamp || new Date().toISOString();
  

  const entrou = reportData.entrou?.length || 0;
  const saiu = reportData.saiu?.length || 0;
  const promovido = reportData.promovido?.length || 0;
  const rebaixado = reportData.rebaixado?.length || 0;
  const nomeAlterado = reportData.nome_alterado?.filter(p => p.nome_antigo && p.nome_novo).length || 0;
  const totalChanges = entrou + saiu + promovido + rebaixado + nomeAlterado;

  if (totalChanges === 0) {
    return [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle(`${EMOJIS.info} Sincronização da Guild`)
        .setDescription('Nenhuma alteração detectada.')
        .setFooter({ text: `${EMOJIS.time} ${timestamp}` })
        .setTimestamp(),
    ];
  }

  // sumario em embed
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.info} Sincronização da Guild`)
    .addFields(
      { name: `${EMOJIS.entrou} Entradas`, value: `${EMOJIS.ponto} ${entrou} membros`, inline: true },
      { name: `${EMOJIS.saiu} Saídas`, value: `${EMOJIS.ponto} ${saiu} membros`, inline: true },
      { name: `${EMOJIS.promovido} Promoções`, value: `${EMOJIS.ponto} ${promovido} membros`, inline: true },
      { name: `${EMOJIS.rebaixado} Rebaixamentos`, value: `${EMOJIS.ponto} ${rebaixado} membros`, inline: true },
      { name: `${EMOJIS.info} Nomes Alterados`, value: `${EMOJIS.ponto} ${nomeAlterado} membros`, inline: true }
    )
    .setFooter({ text: `${EMOJIS.time} ${timestamp}` })
    .setTimestamp();

  embeds.push(embed);
  

  if (entrou > 0) {
    const desc = reportData.entrou
      .map(p => `${EMOJIS.ponto} **${p.nome}** (${p.brawlhalla_id}) - ${p.rank}`)
      .join('\n')
      .slice(0, 4096);
    embeds.push(
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`${EMOJIS.entrou} Entraram (${entrou})`)
        .setDescription(desc)
        .setTimestamp()
    );
  }
  
  if (saiu > 0) {
    const desc = reportData.saiu
      .map(p => `${EMOJIS.ponto} **${p.nome}** (${p.brawlhalla_id}) - ${p.rank}`)
      .join('\n')
      .slice(0, 4096);
    embeds.push(
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`${EMOJIS.saiu} Saíram (${saiu})`)
        .setDescription(desc)
        .setTimestamp()
    );
  }
  
  if (promovido > 0) {
    const desc = reportData.promovido
      .map(p => `${EMOJIS.ponto} **${p.nome}** - ${p.rank_antigo} → ${p.rank_novo}`)
      .join('\n')
      .slice(0, 4096);
    embeds.push(
      new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle(`${EMOJIS.promovido} Promovidos (${promovido})`)
        .setDescription(desc)
        .setTimestamp()
    );
  }
  
  if (rebaixado > 0) {
    const desc = reportData.rebaixado
      .map(p => `${EMOJIS.ponto} **${p.nome}** - ${p.rank_antigo} → ${p.rank_novo}`)
      .join('\n')
      .slice(0, 4096);
    embeds.push(
      new EmbedBuilder()
        .setColor(0xd946ef)
        .setTitle(`${EMOJIS.rebaixado} Rebaixados (${rebaixado})`)
        .setDescription(desc)
        .setTimestamp()
    );
  }
  
  if (nomeAlterado > 0) {
    const desc = reportData.nome_alterado
      .filter(p => p.nome_antigo && p.nome_novo)
      .map(p => `${EMOJIS.ponto} **${p.nome_antigo}** → **${p.nome_novo}**`)
      .join('\n')
      .slice(0, 4096);
    embeds.push(
      new EmbedBuilder()
        .setColor(0x9c27b0)
        .setTitle(`${EMOJIS.info} Nomes Alterados (${nomeAlterado})`)
        .setDescription(desc)
        .setTimestamp()
    );
  }
  
  return embeds;
}

const EMBEDS_PER_MESSAGE = 10;


export async function postGuildActivityToDiscord(client, data, channelId) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.warn('[GuildActivity] Channel not found:', channelId);
    return;
  }
  const embeds = buildEmbedsFromGuildActivity(data);
  if (embeds.length === 0) return;
  for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
    const chunk = embeds.slice(i, i + EMBEDS_PER_MESSAGE);
    await channel.send({ embeds: chunk }).catch((err) => console.error('[GuildActivity] Send failed:', err));
  }
}

function calculateSummary(reportData) {
  const entrou = reportData.entrou?.length || 0;
  const saiu = reportData.saiu?.length || 0;
  const promovido = reportData.promovido?.length || 0;
  const rebaixado = reportData.rebaixado?.length || 0;
  const nome_alterado = reportData.nome_alterado?.filter(p => p.nome_antigo && p.nome_novo).length || 0;
  
  return {
    entrou,
    saiu,
    promovido,
    rebaixado,
    nome_alterado,
    saldo_liquido: entrou - saiu, 
  };
}


export async function runAndPostGuildActivity(client) {
  const channelId = config.channelId || null;
  try {
    const data = await runGuildActivitySync();
    
    const summary = calculateSummary(data.data || {});
    
    if (channelId) {
      await postGuildActivityToDiscord(client, data, channelId);
    }
    return {
      ok: true,
      summary,
      posted: !!channelId,
    };
  } catch (err) {
    console.error('[GuildActivity]', err);
    return { ok: false, posted: false, error: err.message };
  }
}
