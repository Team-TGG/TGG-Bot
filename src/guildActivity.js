/**
 * Guild Activity API: fetch movement logs and post to Discord channel via embeds.
 * Uses the movimentacao endpoint since guild-activity.php doesn't exist.
 */

import { EmbedBuilder } from 'discord.js';
import { guildActivity as config } from '../config/index.js';

const ACTIVITY_URL = () => {
  if (!config.url || !config.key) return null;
  const u = new URL(config.url);
  // No parameters needed, just basic fetch with X-API-Key header
  return u.toString();
};

/**
 * Run the guild activity sync (fetch from movimentacao API with X-API-Key header).
 * @returns {Promise<{ ok: boolean, movimentacao?: object, resumo?: object, periodo?: object }>}
 */
export async function runGuildActivitySync() {
  const url = ACTIVITY_URL();
  if (!url) {
    throw new Error('TGG_API_URL and TGG_API_KEY must be set in .env');
  }

  console.log('[GuildActivity] Fetching from:', url);
  
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': config.key,
    },
  });

  console.log('[GuildActivity] Response status:', res.status);
  
  const data = await res.json().catch(() => null);
  
  if (!res.ok || !data) {
    console.error('[GuildActivity] Error response:', data);
    throw new Error(data?.message || `API returned ${res.status}`);
  }

  console.log('[GuildActivity] Success:', data.success, 'Total registros:', data.movimentacao?.total_registros);
  
  return data;
}

/**
 * Build Discord embeds from API response (movimentacao format).
 * @param {object} data - API response from movimentacao endpoint
 * @returns {EmbedBuilder[]}
 */
export function buildEmbedsFromGuildActivity(data) {
  const embeds = [];
  
  // Custom emoji IDs
  const EMOJIS = {
    entrou: '<:icon_v:825250296987910144>',
    saiu: '<:icon_x:872277999687442472>',
    promovido: '<:icon_up:1471913779280351316>',
    rebaixado: '<:icon_down:1471913822280355921>',
    info: '<:icon_etc:1453118909166256360>',
    time: '<:time2:1406766019589967924>',
    seta: '<a:seta:851206127471034378>',
    ponto: '<:g_ponto_white_RR:1305837905624698880>',
  };

  // Handle movimentacao response structure
  if (!data || !data.resumo) {
    return [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle(`${EMOJIS.info} Sincronização da Guild`)
        .setDescription('Nenhuma alteração detectada.')
        .setTimestamp(),
    ];
  }

  const resumo = data.resumo;
  const periodo = data.periodo || {};
  const totalChanges = (resumo.entrou || 0) + (resumo.saiu || 0) + (resumo.promovido || 0) + (resumo.rebaixado || 0);

  if (totalChanges === 0) {
    return [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle(`${EMOJIS.info} Sincronização da Guild`)
        .setDescription('Nenhuma alteração detectada.')
        .setFooter({ text: `${EMOJIS.time} Período: ${periodo.data_inicio || 'N/A'} a ${periodo.data_fim || 'N/A'}` })
        .setTimestamp(),
    ];
  }

  // Create summary embed with all changes
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${EMOJIS.info} Sincronização da Guild`)
    .addFields(
      { name: `${EMOJIS.entrou} Entradas`, value: `${EMOJIS.ponto} ${resumo.entrou || 0} membros`, inline: true },
      { name: `${EMOJIS.saiu} Saídas`, value: `${EMOJIS.ponto} ${resumo.saiu || 0} membros`, inline: true },
      { name: `${EMOJIS.promovido} Promoções`, value: `${EMOJIS.ponto} ${resumo.promovido || 0} membros`, inline: true },
      { name: `${EMOJIS.rebaixado} Rebaixamentos`, value: `${EMOJIS.ponto} ${resumo.rebaixado || 0} membros`, inline: true },
      { name: `${EMOJIS.ponto} Saldo Líquido`, value: `${EMOJIS.seta} ${resumo.saldo_liquido || 0}`, inline: true }
    )
    .setFooter({ text: `${EMOJIS.time} Período: ${periodo.data_inicio || 'N/A'} a ${periodo.data_fim || 'N/A'}` })
    .setTimestamp();

  embeds.push(embed);
  return embeds;
}

const EMBEDS_PER_MESSAGE = 10;

/**
 * Post guild activity result to a Discord channel (sends embeds in chunks of 10).
 * @param {import('discord.js').Client} client
 * @param {object} data - API response from runGuildActivitySync()
 * @param {string} channelId
 */
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

/**
 * Run sync, then post to Discord if channel is configured.
 * @param {import('discord.js').Client} client
 * @returns {{ ok: boolean, summary?: object, posted: boolean, error?: string }}
 */
export async function runAndPostGuildActivity(client) {
  const channelId = config.channelId || null;
  try {
    const data = await runGuildActivitySync();
    if (channelId) {
      await postGuildActivityToDiscord(client, data, channelId);
    }
    return {
      ok: true,
      summary: data.resumo || data.summary || {},
      posted: !!channelId,
      run_at: data.run_at,
    };
  } catch (err) {
    console.error('[GuildActivity]', err);
    return { ok: false, posted: false, error: err.message };
  }
}
