import { EmbedBuilder } from 'discord.js';
import { getUserByDiscordId } from './db.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Cache config ─────────────────────────────────────────────────────────────
const CACHE_FILE = resolve(process.cwd(), 'brawlhalla_cache.json');
const CACHE_TTL  = 20 * 60 * 1000; // 20 min – safe with 180 req/15 min limit

// ─── Rate limiter: 180 requests per 15 minutes ────────────────────────────────
const RATE_LIMIT   = 180;
const RATE_WINDOW  = 15 * 60 * 1000;
const requestLog   = [];

function canRequest() {
  const now = Date.now();
  // Remove entries older than the window
  while (requestLog.length && now - requestLog[0] > RATE_WINDOW) requestLog.shift();
  return requestLog.length < RATE_LIMIT;
}

function recordRequest() {
  requestLog.push(Date.now());
}

function rateLimitWait() {
  const now = Date.now();
  while (requestLog.length && now - requestLog[0] > RATE_WINDOW) requestLog.shift();
  if (requestLog.length < RATE_LIMIT) return 0;
  // Time until oldest request expires
  return RATE_WINDOW - (now - requestLog[0]) + 50;
}

async function apiFetch(url) {
  const wait = rateLimitWait();
  if (wait > 0) {
    console.warn(`[Brawlhalla] Rate limit reached, waiting ${wait}ms`);
    await new Promise(r => setTimeout(r, wait));
  }
  recordRequest();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API Error ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// ─── JSON file cache persistence ──────────────────────────────────────────────
let cache = {};

function loadCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
      console.log(`[Brawlhalla] Cache loaded from ${CACHE_FILE}`);
    }
  } catch (err) {
    console.warn('[Brawlhalla] Failed to load cache file:', err.message);
    cache = {};
  }
}

function saveCache() {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Brawlhalla] Failed to save cache file:', err.message);
  }
}

export function getCached(key, ignoreTtl = false) {
  const entry = cache[key];
  if (!entry) return null;
  if (!ignoreTtl && Date.now() - entry.timestamp > CACHE_TTL) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  cache[key] = { data, timestamp: Date.now() };
  saveCache();
}



// ─── Legends mapping cache (single fetch for the entire session) ───────────────
let legendsDataCache = null;

async function fetchLegends() {
  if (legendsDataCache) return legendsDataCache;
  const cached = getCached('__legends__', true); // Ignore TTL for legends
  if (cached) {
    legendsDataCache = {};
    for (const [key, val] of Object.entries(cached)) {
      legendsDataCache[key] = {
        weapon_one: normalizeWeapon(val.weapon_one),
        weapon_two: normalizeWeapon(val.weapon_two)
      };
    }
    return legendsDataCache;
  }
  try {
    const data = await apiFetch(
      `https://api.brawlhalla.com/legend/all?api_key=${process.env.BRAWLHALLA_API_KEY}`
    );
    legendsDataCache = {};
    data.forEach(legend => {
      legendsDataCache[legend.legend_name_key] = {
        weapon_one: normalizeWeapon(legend.weapon_one),
        weapon_two: normalizeWeapon(legend.weapon_two)
      };
    });
    setCached('__legends__', legendsDataCache);
  } catch (err) {
    console.error('[Brawlhalla] Error fetching legends mapping:', err.message);
  }
  return legendsDataCache;
}

// ─── Icon maps ────────────────────────────────────────────────────────────────
const LEGEND_EMOJIS = {
  'ada': '<:Ada:1480883379275563040>',
  'arcadia': '<:Arcadia:1480883381754658866>',
  'artemis': '<:Artemis:1480883384291954829>',
  'asuri': '<:Asuri:1480883386334843003>',
  'azoth': '<:Azoth:1480883389174382602>',
  'barraza': '<:Barraza:1480883392856850483>',
  'bodvar': '<:Bodvar:1480883395692331039>',
  'brynn': '<:Brynn:1480883398368297030>',
  'caspian': '<:Caspian:1480883401618620597>',
  'cassidy': '<:Cassidy:1480883404806422550>',
  'cross': '<:Cross:1480883407822131241>',
  'diana': '<:Diana:1480883410556686427>',
  'dusk': '<:Dusk:1480883413748547735>',
  'ember': '<:Ember:1480883416508661831>',
  'ezio': '<:Ezio:1480883419138490428>',
  'fait': '<:Fait:1480883421841293412>',
  'gnash': '<:Gnash:1480883425173835887>',
  'hattori': '<:Hattori:1480883427052879983>',
  'imugi': '<:Imugi:1480883429523456151>',
  'isaiah': '<:Isaiah:1480883431872401480>',
  'jaeyun': '<:Jaeyun:1480883434636443721>',
  'jhala': '<:Jhala:1480883437844824115>',
  'jiro': '<:Jiro:1480883440286175252>',
  'kaya': '<:Kaya:1480883442660020265>',
  'kingzuva': '<:Kingzuva:1480883444622954506>',
  'koji': '<:Koji:1480883447529603254>',
  'kor': '<:Kor:1480883450704564421>',
  'ladyvera': '<:LadyVera:1480883803893194792>',
  'linfei': '<:LinFei:1480883454055944202>',
  'loki': '<:Loki:1480883456576716881>',
  'lordvraxx': '<:LordVraxx:1480883458933919848>',
  'lucien': '<:Lucien:1480883461018615839>',
  'magyar': '<:Magyar:1480883463539261542>',
  'mako': '<:Mako:1480883465330364506>',
  'mirage': '<:Mirage:1480883467846946859>',
  'mordex': '<:Mordex:1480883470204014714>',
  'munin': '<:Munin:1480883472141783243>',
  'nix': '<:Nix:1480883476738605231>',
  'onyx': '<:Onyx:1480883479519428739>',
  'orion': '<:Orion:1480883481574768750>',
  'petra': '<:Petra:1480883483801948181>',
  'priya': '<:Priya:1480883486004088882>',
  'queennai': '<:QueenNai:1480883494510133411>',
  'ragnir': '<:Ragnir:1480883496703492206>',
  'rayman': '<:Rayman:1480883498536669335>',
  'redraptor': '<:Redraptor:1480883500239290449>',
  'reno': '<:Reno:1480883502378389566>',
  'ransom': '<:Ransom:1480883794545676288>',
  'rupture': '<:Rupture:1480883794545676288>',
  'scarlet': '<:Scarlet:1480883504169488495>',
  'sentinel': '<:Sentinel:1480883506346328107>',
  'seven': '<:Seven:1480883508904857610>',
  'sidra': '<:Sidra:1480883511790665728>',
  'sirroland': '<:SirRoland:1480883514542129224>',
  'teros': '<:Teros:1480883517549314170>',
  'tezca': '<:Tezca:1480883519931678761>',
  'thatch': '<:Thatch:1480883522720760010>',
  'thea': '<:Thea:1480883525086609448>',
  'thor': '<:Thor:1480883527196344412>',
  'ulgrim': '<:Ulgrim:1480883534183927839>',
  'val': '<:Val:1480883536612298793>',
  'vector': '<:Vector:1480883539569545246>',
  'vivi': '<:Vivi:1480883541947449365>',
  'volkov': '<:Volkov:1480883544396927126>',
  'wushang': '<:WuShang:1480883546636685402>',
  'xull': '<:Xull:1480883555843313705>',
  'yumiko': '<:Yumiko:1480883558204837909>',
  'zariel': '<:Zariel:1480883560641728634>'
};


const WEAPON_ICONS = {
  'axe': '<:Axe:1480882487348428920>',
  'battleboots': '<:BattleBoots:1480882462769807423>',
  'blasters': '<:Blasters:1480882489198117026>',
  'bow': '<:Bow:1480882490511196231>',
  'cannon': '<:Cannon:1480882492503494697>',
  'chakram': '<:Chakram:1480882494470361158>',
  'gauntlet': '<:Gauntlets:1480882496764907642>',
  'grapplehammer': '<:GrappleHammer:1480882498186514492>',
  'greatsword': '<:Greatsword:1480882500283797715>',
  'katars': '<:Katars:1480882501684822126>',
  'orb': '<:Orb:1480882503265943704>',
  'rocketlance': '<:RocketLance:1480882504918372352>',
  'scythe': '<:Scythe:1480882506638299147>',
  'spear': '<:Spear:1480882508487983195>',
  'sword': '<:Sword:1480882510438072351>',
  'unarmed': '<:Unarmed:1480882512250015854>'
};

const RANK_ICONS = {
  'bronze0': '<:Bronze0:1480881973109981289>',
  'bronze1': '<:Bronze1:1480881975878352947>',
  'bronze2': '<:Bronze2:1480881978780815511>',
  'bronze3': '<:Bronze3:1480881980378841170>',
  'bronze4': '<:Bronze4:1480881982295769088>',
  'bronze5': '<:Bronze5:1480881984933986404>',
  'gold0': '<:Gold0:1480881990768005130>',
  'gold1': '<:Gold1:1480881992538132592>',
  'gold2': '<:Gold2:1480881995201384539>',
  'gold3': '<:Gold3:1480881998733246515>',
  'gold4': '<:Gold4:1480882001237118976>',
  'gold5': '<:Gold5:1480882003128615054>',
  'platinum0': '<:Platinum0:1480882007176122418>',
  'platinum1': '<:Platinum1:1480882009231462401>',
  'platinum2': '<:Platinum2:1480882011496513556>',
  'platinum3': '<:Platinum3:1480882014336061490>',
  'platinum4': '<:Platinum4:1480882017515343903>',
  'platinum5': '<:Platinum5:1480882019683794944>',
  'diamond': '<:Diamond:1480881987827793991>',
  'silver0': '<:Silver0:1480882021457727498>',
  'silver1': '<:Silver1:1480882023731036210>',
  'silver2': '<:Silver2:1480882025454895266>',
  'silver3': '<:Silver3:1480882028030328902>',
  'silver4': '<:Silver4:1480882023101111317>',
  'silver5': '<:Silver5:1480882035957563505>',
  'tin0': '<:Tin0:1480882038323024013>',
  'tin1': '<:Tin1:1480882040990728272>',
  'tin2': '<:Tin2:1480882043641663588>',
  'tin3': '<:Tin3:1480882046413836429>',
  'tin4': '<:Tin4:1480882048771035229>',
  'tin5': '<:Tin5:1480882050474053652>'
};

const LEGEND_NAMES = {
  bodvar: 'Bödvar', cassidy: 'Cassidy', orion: 'Orion', lordvraxx: 'Lord Vraxx',
  gnash: 'Gnash', queennai: 'Queen Nai', hattori: 'Hattori', thatch: 'Thatch',
  ada: 'Ada', scarlet: 'Scarlet', sentinel: 'Sentinel', sirroland: 'Sir Roland',
  lucien: 'Lucien', teros: 'Teros', brynn: 'Brynn', asuri: 'Asuri',
  barraza: 'Barraza', ember: 'Ember', azoth: 'Azoth', koji: 'Koji',
  ulgrim: 'Ulgrim', diana: 'Diana', jhala: 'Jhala', kor: 'Kor',
  wushang: 'Wu Shang', val: 'Val', ragnir: 'Ragnir', cross: 'Cross',
  mirage: 'Mirage', nix: 'Nix', mordex: 'Mordex', yumiko: 'Yumiko',
  artemis: 'Artemis', caspian: 'Caspian', sidra: 'Sidra', xull: 'Xull',
  kaya: 'Kaya', isaiah: 'Isaiah', jiro: 'Jiro', linfei: 'Lin Fei',
  zariel: 'Zariel', rayman: 'Rayman', dusk: 'Dusk', fait: 'Fait',
  thor: 'Thor', petra: 'Petra', vector: 'Vector', volkov: 'Volkov',
  onyx: 'Onyx', jaeyun: 'Jaeyun', mako: 'Mako', magyar: 'Magyar',
  reno: 'Reno', munin: 'Munin', arcadia: 'Arcadia', ezio: 'Ezio',
  tezca: 'Tezca', thea: 'Thea', redraptor: 'Red Raptor', loki: 'Loki',
  seven: 'Seven', vivi: 'Vivi', imugi: 'Imugi', kingzuva: 'King Zuva',
  priya: 'Priya', ransom: 'Ransom', ladyvera: 'Lady Vera', rupture: 'Rupture'
};

function normalizeWeapon(w) {
  if (!w) return w;
  const lw = w.toLowerCase().replace(/\s+/g, '');
  if (lw === 'fists' || lw === 'gauntlets') return 'Gauntlet';
  if (lw === 'pistol') return 'Blasters';
  if (lw === 'boots' || lw === 'battleboots') return 'Battle Boots';
  if (lw === 'rocketlance') return 'RocketLance';
  if (lw === 'hammer') return 'GrappleHammer';
  return w;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0h 0m 0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function cleanLegendName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '');
}

function getRankIcon(tier) {
  if (!tier) return '❓';
  return RANK_ICONS[tier.toLowerCase().replace(/\s+/g, '')] || '❓';
}

function normalizeUnicode(str) {
  if (!str || typeof str !== 'string') return str;
  try {
    return decodeURIComponent(escape(str));
  } catch {
    return str.normalize('NFC');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchPlayerStats(brawlhallaId) {
  const key = `player:${brawlhallaId}`;
  const hit = getCached(key);
  if (hit) {
    console.log(`[Brawlhalla] Cache hit for player ${brawlhallaId}`);
    return hit;
  }

  // Ensure legends mapping is loaded (1 API call, cached separately)
  if (!legendsDataCache) await fetchLegends();

  try {
    // Fetch stats + ranked in parallel (2 API calls)
    const [statsData, rankedData] = await Promise.all([
      apiFetch(`https://api.brawlhalla.com/player/${brawlhallaId}/stats?api_key=${process.env.BRAWLHALLA_API_KEY}`),
      apiFetch(`https://api.brawlhalla.com/player/${brawlhallaId}/ranked?api_key=${process.env.BRAWLHALLA_API_KEY}`)
    ]);

    if (statsData.name)             statsData.name             = normalizeUnicode(statsData.name);
    if (statsData.clan?.clan_name)  statsData.clan.clan_name   = normalizeUnicode(statsData.clan.clan_name);

    const combined = { ...statsData, ranked: rankedData };
    setCached(key, combined);
    return combined;
  } catch (err) {
    console.warn(`[Brawlhalla] API fetch failed for player ${brawlhallaId}, checking stale cache:`, err.message);
    const stale = getCached(key, true);
    if (stale) return stale;
    throw err;
  }
}

export async function fetchClanStats(clanId = process.env.BRAWLHALLA_CLAN_ID || '396943') {
  const key = `clan:${clanId}`;
  const hit = getCached(key);
  if (hit) {
    console.log(`[Brawlhalla] Cache hit for clan ${clanId}`);
    return hit;
  }

  try {
    const data = await apiFetch(
      `https://api.brawlhalla.com/clan/${clanId}?api_key=${process.env.BRAWLHALLA_API_KEY}`
    );

    if (data.clan_name) data.clan_name = normalizeUnicode(data.clan_name);
    if (Array.isArray(data.clan)) {
      data.clan = data.clan.map(m => ({ ...m, name: normalizeUnicode(m.name) }));
    }

    setCached(key, data);
    return data;
  } catch (err) {
    console.warn(`[Brawlhalla] API fetch failed for clan ${clanId}, checking stale cache:`, err.message);
    const stale = getCached(key, true);
    if (stale) return stale;
    throw err;
  }
}

export async function getUserBrawlhallaId(discordId) {
  try {
    const user = await getUserByDiscordId(discordId);
    return user?.brawlhalla_id ?? null;
  } catch (err) {
    console.error('[Brawlhalla] Error getting brawlhalla_id:', err.message);
    return null;
  }
}

// ─── Embed builders ───────────────────────────────────────────────────────────

export function createStatsEmbed(playerData) {
  const stats  = playerData || {};
  const ranked = stats.ranked || {};
  const legends = stats.legends || [];

  const rankIcon = getRankIcon(ranked.tier);

  const mostPlayedLegend = legends.length
    ? legends.reduce((a, b) => ((b.games || 0) > (a.games || 0) ? b : a))
    : null;

  let displayLegendName = 'Unknown';
  let legendIcon = '❓';
  if (mostPlayedLegend) {
    const key = cleanLegendName(mostPlayedLegend.legend_name_key);
    displayLegendName = LEGEND_NAMES[key] || mostPlayedLegend.legend_name_key || 'Unknown';
    legendIcon = LEGEND_EMOJIS[key] || '❓';
  }

  const totalPlaytime = legends.reduce((s, l) => s + parseInt(l.matchtime || 0), 0);

  let weaponName = 'Unknown';
  let weaponIcon = '❓';
  if (mostPlayedLegend) {
    const legendKey = cleanLegendName(mostPlayedLegend.legend_name_key);
    const mapping   = legendsDataCache?.[mostPlayedLegend.legend_name_key];
    const w1 = parseInt(mostPlayedLegend.timeheldweaponone || 0);
    const w2 = parseInt(mostPlayedLegend.timeheldweapontwo || 0);
    weaponName = w1 > w2 ? (mapping?.weapon_one || 'Weapon One') : (mapping?.weapon_two || 'Weapon Two');
    weaponIcon = WEAPON_ICONS[weaponName.toLowerCase().replace(/\s+/g, '')] || '❓';
  }

  const totalKos      = legends.reduce((s, l) => s + parseInt(l.kos        || 0), 0);
  const totalFalls    = legends.reduce((s, l) => s + parseInt(l.falls       || 0), 0);
  const totalSuicides = legends.reduce((s, l) => s + parseInt(l.suicides    || 0), 0);
  const totalTeamKos  = legends.reduce((s, l) => s + parseInt(l.teamkos     || 0), 0);
  const totalDealt    = legends.reduce((s, l) => s + parseInt(l.damagedealt || 0), 0);
  const totalTaken    = legends.reduce((s, l) => s + parseInt(l.damagetaken || 0), 0);

  const events    = totalKos + totalFalls;
  const koRate    = events > 0 ? ((totalKos   / events) * 100).toFixed(1) : 0;
  const fallRate  = events > 0 ? ((totalFalls / events) * 100).toFixed(1) : 0;
  const totalDmg  = totalDealt + totalTaken;
  const dealtPct  = totalDmg > 0 ? ((totalDealt / totalDmg) * 100).toFixed(1) : 0;
  const takenPct  = totalDmg > 0 ? ((totalTaken / totalDmg) * 100).toFixed(1) : 0;

  const wins    = stats.wins  || 0;
  const games   = stats.games || 0;
  const losses  = games - wins;
  const winRate = games > 0 ? ((wins / games) * 100).toFixed(1) : 0;
  const rating  = ranked.rating || 'Unranked';
  const tier    = ranked.tier   || 'N/A';
  const mostLegendTime = mostPlayedLegend ? parseInt(mostPlayedLegend.matchtime || 0) : 0;

  return new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`${rankIcon} ${stats.name || 'Player'} — Brawlhalla Stats`)
    .addFields(
      {
        name: '📊 Main Stats',
        value:
          `**Level:** ${stats.level || 0}\n` +
          `**XP:** ${formatNumber(stats.xp || 0)}\n` +
          `**Playtime:** ${formatTime(totalPlaytime)}\n` +
          `**Rating:** ${typeof rating === 'number' ? formatNumber(rating) : rating}\n` +
          `**Tier:** ${tier}`,
        inline: false
      },
      {
        name: '⚔️ Overall Record',
        value: `${formatNumber(wins)} W · ${formatNumber(losses)} L · ${formatNumber(games)} games (${winRate}%)`,
        inline: false
      },
      {
        name: '🏆 Most Played Legend',
        value: mostPlayedLegend
          ? `${legendIcon} **${displayLegendName}** — ${mostPlayedLegend.games} games · Lv ${mostPlayedLegend.level}\nTime: ${formatTime(mostLegendTime)}`
          : 'No data',
        inline: false
      },
      {
        name: '🗡️ Main Weapon',
        value: `${weaponIcon} **${weaponName}**`,
        inline: true
      },
      {
        name: '💥 Combat',
        value:
          `**KOs:** ${formatNumber(totalKos)} (${koRate}%)\n` +
          `**Falls:** ${formatNumber(totalFalls)} (${fallRate}%)\n` +
          `**Suicides:** ${formatNumber(totalSuicides)} · **Team KOs:** ${formatNumber(totalTeamKos)}`,
        inline: false
      },
      {
        name: '📈 Damage',
        value:
          `**Dealt:** ${formatNumber(totalDealt)} (${dealtPct}%)\n` +
          `**Taken:** ${formatNumber(totalTaken)} (${takenPct}%)`,
        inline: false
      }
    )
    .setFooter({ text: 'Brawlhalla Stats • TGG Bot' })
    .setTimestamp();
}

export function createClanEmbed(clanData) {
  const clanName     = normalizeUnicode(clanData.clan_name || 'Unknown Clan');
  const clanId       = clanData.clan_id || 'N/A';
  const createDate   = clanData.clan_create_date || 0;
  const lifetimeXp   = clanData.clan_lifetime_xp || 0;
  const members      = clanData.clan || [];
  const topMembers   = [...members].sort((a, b) => (b.xp || 0) - (a.xp || 0)).slice(0, 10);

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`🏰 ${clanName} — Clan Stats`)
    .addFields(
      {
        name: '📊 Info',
        value:
          `**ID:** ${clanId}\n` +
          `**Created:** ${createDate ? new Date(createDate * 1000).toLocaleDateString('pt-BR') : 'N/A'}\n` +
          `**Members:** ${members.length}/100\n` +
          `**Lifetime XP:** ${formatNumber(lifetimeXp)}`,
        inline: false
      },
      {
        name: '🏆 Top 10 Members',
        value: topMembers.length > 0
          ? topMembers.map((m, i) => {
              const badge = m.rank === 'Leader' ? '👑' : m.rank === 'Officer' ? '⚔️' : '🗡️';
              return `**${i + 1}.** ${badge} ${normalizeUnicode(m.name || 'Unknown')} — ${formatNumber(m.xp || 0)} XP`;
            }).join('\n')
          : 'No members',
        inline: false
      }
    )
    .setFooter({ text: 'Brawlhalla Clan Stats • TGG Bot' })
    .setTimestamp();
}

export function clearCache() {
  cache = {};
  saveCache();
  legendsDataCache = null;
}

// ─── Initialization ───────────────────────────────────────────────────────────
// Load on module init and pre-warm legend mapping
loadCache();
// Eagerly populate legend mapping — runs once per process lifetime.
// If the JSON cache already has __legends__, this costs 0 API calls.
fetchLegends().catch(err => console.warn('[Brawlhalla] Pre-warm legends failed:', err.message));
