import { EmbedBuilder } from 'discord.js';
import { getGuildWeeklyGuildPoints } from './guild.js';
import { getUserByDiscordId, resolveBrawlhallaId, loadAliases, getMissionWeekEnd, getMissionWeekStart } from './db.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';

// Configuração do cache
const CACHE_DIR = resolve(process.cwd(), 'cache');
const SHARED_FILE = resolve(CACHE_DIR, 'shared.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 min

if (!existsSync(CACHE_DIR)) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`[Brawlhalla] Created cache directory: ${CACHE_DIR}`);
  } catch (err) {
    console.warn('[Brawlhalla] Failed to create cache directory:', err.message);
  }
}

// limitador de req
const RATE_LIMIT = 180;
const RATE_WINDOW = 15 * 60 * 1000;
const requestLog = [];

function canRequest() {
  const now = Date.now();
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
  return RATE_WINDOW - (now - requestLog[0]) + 50;
}

async function apiFetch(url) {
  const wait = rateLimitWait();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  recordRequest();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API Error ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

function getSharedData() {
  try {
    if (existsSync(SHARED_FILE)) {
      return JSON.parse(readFileSync(SHARED_FILE, 'utf8'));
    }
  } catch { }
  return {};
}

function setSharedData(data) {
  try {
    writeFileSync(SHARED_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch { }
}

export function getCached(key, ignoreTtl = false) {
  try {
    if (key === '__legends__') {
      return getSharedData()['__legends__']?.data || null;
    }
    if (key.startsWith('player:')) {
      const bhid = key.split(':')[1];
      const path = resolve(CACHE_DIR, `player_${bhid}.json`);
      if (existsSync(path)) {
        const entry = JSON.parse(readFileSync(path, 'utf8'));
        if (!ignoreTtl && Date.now() - entry.timestamp > CACHE_TTL) return null;
        return entry.data;
      }
    }
  } catch { }
  return null;
}

function setCached(key, data) {
  try {
    const entry = { data, timestamp: Date.now() };
    if (key === '__legends__') {
      const shared = getSharedData();
      shared['__legends__'] = entry;
      setSharedData(shared);
    } else if (key.startsWith('player:')) {
      const bhid = key.split(':')[1];
      writeFileSync(resolve(CACHE_DIR, `player_${bhid}.json`), JSON.stringify(entry, null, 2));
    }
  } catch { }
}



// cache de legends
let legendsDataCache = null;

async function fetchLegends() {
  if (legendsDataCache) return legendsDataCache;
  const cached = getCached('__legends__', true);
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
  'fait': '<:fait:1480883422388944926>',
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
  'boots': '<:BattleBoots:1480882462769807423>',
  'blasters': '<:Blasters:1480882489198117026>',
  'pistol': '<:Blasters:1480882489198117026>',
  'bow': '<:Bow:1480882490511196231>',
  'cannon': '<:Cannon:1480882492503494697>',
  'chakram': '<:Chakram:1480882494470361158>',
  'gauntlets': '<:Gauntlets:1480882496764907642>',
  'gauntlet': '<:Gauntlets:1480882496764907642>',
  'fists': '<:Gauntlets:1480882496764907642>',
  'hammer': '<:GrappleHammer:1480882498186514492>',
  'grapplehammer': '<:GrappleHammer:1480882498186514492>',
  'greatsword': '<:Greatsword:1480882500283797715>',
  'katars': '<:Katars:1480882501684822126>',
  'katar': '<:Katars:1480882501684822126>',
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

const LEGEND_IDS = {
  3: 'bodvar', 4: 'cassidy', 5: 'orion', 6: 'lordvraxx',
  7: 'gnash', 8: 'queennai', 10: 'hattori', 11: 'sirroland', 
  12: 'scarlet', 13: 'thatch', 14: 'ada',  15: 'sentinel', 
  9: 'lucien', 16: 'teros', 19: 'brynn', 20: 'asuri',
  21: 'barraza', 18: 'ember', 23: 'azoth', 24: 'koji',
  22: 'ulgrim', 25: 'diana', 26: 'jhala', 28: 'kor',
  29: 'wushang', 30: 'val', 31: 'ragnir', 32: 'cross',
  33: 'mirage', 34: 'nix', 35: 'mordex', 36: 'yumiko',
  37: 'artemis', 38: 'caspian', 39: 'sidra', 40: 'xull',
  42: 'kaya', 41: 'isaiah', 43: 'jiro', 44: 'linfei',
  45: 'zariel', 46: 'rayman', 47: 'dusk', 48: 'fait',
  49: 'thor', 50: 'petra', 51: 'vector', 52: 'volkov',
  53: 'onyx', 54: 'jaeyun', 55: 'mako', 56: 'magyar',
  57: 'reno', 58: 'munin', 59: 'arcadia', 60: 'ezio',
  63: 'tezca', 62: 'thea', 17: 'redraptor', 27: 'loki',
  61: 'seven', 64: 'vivi', 65: 'imugi', 66: 'kingzuva',
  67: 'priya', 68: 'ransom', 69: 'ladyvera', 70: 'rupture'
};

function normalizeWeapon(w) {
  if (!w) return w;
  const lw = w.toLowerCase().replace(/\s+/g, '');
  if (lw === 'fists' || lw === 'gauntlet' || lw === 'gauntlets') return 'Gauntlets';
  if (lw === 'katar' || lw === 'katars') return 'Katars';
  if (lw === 'pistol' || lw === 'blasters') return 'Blasters';
  if (lw === 'boots' || lw === 'battleboots') return 'Battle Boots';
  if (lw === 'rocketlance') return 'Rocket Lance';
  if (lw === 'hammer' || lw === 'grapplehammer') return 'Hammer';
  return w;
}


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
    const decoded = decodeURIComponent(escape(str));
    return decoded.normalize('NFC');
  } catch {
    return str
      .replace(/â„¢/g, '™')
      .replace(/â¢/g, '™')
      .replace(/â\x84\xA2/g, '™')
      .replace(/â€¢/g, '•')
      .replace(/â€“/g, '–')
      .replace(/â€”/g, '—')
      .replace(/â€/g, '"')
      .replace(/â€™/g, "'")
      .normalize('NFC');
  }
}

// API

export async function fetchPlayerStats(brawlhallaId) {
  await loadAliases(); // Garante que os aliases foram carregados

  // Resolve o ID (caso seja um alt)
  const resolvedId = resolveBrawlhallaId(String(brawlhallaId));

  const key = `player:${resolvedId}`;
  const hit = getCached(key);

  if (hit) {
    console.log(`[Brawlhalla] Cache hit for player ${resolvedId}`);
    return hit;
  }

  if (!legendsDataCache) await fetchLegends();

  try {
    const [statsData, rankedData] = await Promise.all([
      apiFetch(`https://api.brawlhalla.com/player/${resolvedId}/stats?api_key=${process.env.BRAWLHALLA_API_KEY}`),
      apiFetch(`https://api.brawlhalla.com/player/${resolvedId}/ranked?api_key=${process.env.BRAWLHALLA_API_KEY}`)
    ]);

    if (statsData.name) statsData.name = normalizeUnicode(statsData.name);
    if (statsData.clan?.clan_name) statsData.clan.clan_name = normalizeUnicode(statsData.clan.clan_name);

    if (rankedData.name) rankedData.name = normalizeUnicode(rankedData.name);
    if (Array.isArray(rankedData['2v2'])) {
      rankedData['2v2'] = rankedData['2v2'].map(t => ({ ...t, teamname: normalizeUnicode(t.teamname) }));
    }
    if (rankedData.rotating_ranked) {
      if (Array.isArray(rankedData.rotating_ranked)) {
        rankedData.rotating_ranked = rankedData.rotating_ranked.map(t => ({
          ...t,
          teamname: normalizeUnicode(t.teamname || t.name)
        }));
      } else if (typeof rankedData.rotating_ranked === 'object') {
        const t = rankedData.rotating_ranked;
        t.teamname = normalizeUnicode(t.teamname || t.name);
      }
    }

    const combined = { ...statsData, ranked: rankedData };
    
    setCached(key, combined);
    return combined;
  } catch (err) {
    const stale = getCached(key, true);
    if (stale) return stale;
    throw err;
  }
}

export async function fetchPlayerStatsNoResolve(brawlhallaId) {

  const key = `player:${brawlhallaId}`;
  const hit = getCached(key);

  if (hit) {
    console.log(`[Brawlhalla] Cache hit for player ${brawlhallaId}`);
    return hit;
  }

  if (!legendsDataCache) await fetchLegends();

  try {
    const statsData = await apiFetch(`https://api.brawlhalla.com/player/${brawlhallaId}/stats?api_key=${process.env.BRAWLHALLA_API_KEY}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const rankedData = await apiFetch(`https://api.brawlhalla.com/player/${brawlhallaId}/ranked?api_key=${process.env.BRAWLHALLA_API_KEY}`);

    if (statsData.name) statsData.name = normalizeUnicode(statsData.name);
    if (statsData.clan?.clan_name) statsData.clan.clan_name = normalizeUnicode(statsData.clan.clan_name);

    if (rankedData.name) rankedData.name = normalizeUnicode(rankedData.name);
    if (Array.isArray(rankedData['2v2'])) {
      rankedData['2v2'] = rankedData['2v2'].map(t => ({ ...t, teamname: normalizeUnicode(t.teamname) }));
    }
    if (rankedData.rotating_ranked) {
      if (Array.isArray(rankedData.rotating_ranked)) {
        rankedData.rotating_ranked = rankedData.rotating_ranked.map(t => ({
          ...t,
          teamname: normalizeUnicode(t.teamname || t.name)
        }));
      } else if (typeof rankedData.rotating_ranked === 'object') {
        const t = rankedData.rotating_ranked;
        t.teamname = normalizeUnicode(t.teamname || t.name);
      }
    }

    const combined = { ...statsData, ranked: rankedData };
    
    setCached(key, combined);
    return combined;
  } catch (err) {
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

// NEW 1.0 API (Tests First)

// Validar as respostas da API (Stats)
function validateStatsResponse(data, label) {

  if (!data || typeof data !== 'object') {
    throw new Error(`${label}: Empty response`);
  }

  if (Object.keys(data).length === 0) {
    throw new Error(`${label}: Empty object`);
  }

  if (!data.name) {
    throw new Error(`${label}: Missing player name`);
  }

  return true;
}

// Validar as respostas da API (Ranked)
function validateRankedResponse(data, label) {
  validateStatsResponse(data, label);

  // Detecta resposta bugada da API
  if (data.games === 0 && data.wins === 0 && data.rating === 0) {
    throw new Error(`${label}: Suspicious zeroed ranked data`);
  }

  return true;
}

// NEW STATS
export async function fetchPlayerStatsNewAPI(brawlhallaId) {
  await loadAliases();

  // Resolve o ID (caso seja alt)
  const resolvedId = resolveBrawlhallaId(String(brawlhallaId));

  const key = `player:${resolvedId}`;
  const hit = getCached(key);

  if (hit) {
    console.log(`[Brawlhalla] Cache hit for player ${resolvedId}`);
    return hit;
  }

  if (!legendsDataCache) {
    await fetchLegends();
  }

  try {

    console.log(`[Brawlhalla] Fetching player ${resolvedId}`);
    const results = await Promise.allSettled([

      // Stats Geral
      apiFetch(`https://api.brawlhalla.com/v1/player/stats?brawlhalla_id=${resolvedId}`),

      // Ranked 1v1
      apiFetch(`https://api.brawlhalla.com/v1/player/stats?brawlhalla_id=${resolvedId}&mode=ranked_1v1`),

      // Legacy 2v2 (v0)
      apiFetch(`https://api.brawlhalla.com/player/${resolvedId}/ranked?api_key=${process.env.BRAWLHALLA_API_KEY}`),

      // Ranked 3v3
      apiFetch(`https://api.brawlhalla.com/v1/player/stats?brawlhalla_id=${resolvedId}&mode=ranked_3v3`)
    ]);

    // Verifica falhas individuais
    results.forEach((result, index) => {
      if (result.status === 'rejected') {

        const labels = ['General Stats', 'Ranked 1v1', 'Ranked 2v2', 'Ranked 3v3'];

        console.error(`[Brawlhalla] ${labels[index]} failed for ${resolvedId}`);
        console.error(result.reason);

        throw result.reason;
      }
    });

    const [statsResult, ranked1v1Result, ranked2v2Result, ranked3v3Result] = results;

    const statsData = statsResult.value;
    const ranked1v1Data = ranked1v1Result.value;
    const ranked2v2DataRaw = ranked2v2Result.value;
    const ranked3v3Data = ranked3v3Result.value;

    // Logs brutos
    console.log('[Brawlhalla] Raw responses:', {statsData, ranked1v1Data, ranked2v2DataRaw, ranked3v3Data});

    // Validações
    validateStatsResponse(statsData, 'General Stats');
    validateRankedResponse(ranked1v1Data, 'Ranked 1v1');
    validateStatsResponse(ranked3v3Data, 'Ranked 3v3');

    if (!ranked2v2DataRaw || typeof ranked2v2DataRaw !== 'object') {
      throw new Error(`Ranked 2v2: Invalid response`);
    }

    // Snapshot resumido
    console.log('[Brawlhalla] Validation snapshot:', {
      statsName: statsData?.name,
      statsLevel: statsData?.level,
      ranked1v1Rating: ranked1v1Data?.rating,
      ranked1v1Games: ranked1v1Data?.games,
      ranked2v2Teams: ranked2v2DataRaw?.["2v2"]?.length,
      ranked3v3Games: ranked3v3Data?.games
    });

    // Normalizar nomes com unicode estranho
    if (statsData.name) {
      statsData.name = normalizeUnicode(statsData.name);
    }

    if (statsData.clan?.clan_name) {
      statsData.clan.clan_name = normalizeUnicode(statsData.clan.clan_name);
    }

    // Normalizar 1v1
    if (ranked1v1Data.name) {
      ranked1v1Data.name = normalizeUnicode(ranked1v1Data.name);
    }

    // Normalizar times na 2v2
    const ranked2v2Data = {
      ...ranked2v2DataRaw
    };

    if (Array.isArray(ranked2v2Data["2v2"])) {
      ranked2v2Data["2v2"] = ranked2v2Data["2v2"].map(team => ({
          ...team,
          teamname: normalizeUnicode(team.teamname || team.team_name || "")
        }));
    }

    // Normalizar 3v3
    if (ranked3v3Data.name) {
      ranked3v3Data.name = normalizeUnicode(ranked3v3Data.name);
    }

    // Estrutura semelhante ao que era usado na API antiga
    const ranked = {

      // 1v1
      tier: ranked1v1Data.tier,
      rating: ranked1v1Data.rating,
      peak_rating: ranked1v1Data.peak_rating,
      wins: ranked1v1Data.wins,
      games: ranked1v1Data.games,
      region: ranked1v1Data.region,
      global_rank: ranked1v1Data.global_rank,
      region_rank: ranked1v1Data.region_rank,
      legends: ranked1v1Data.legends || [],

      // Legacy 2v2 (Ainda não uso a nova por conta do erro 500)
      "2v2": ranked2v2Data["2v2"] || [],

      // Novo 3v3
      "3v3": ranked3v3Data
    };

    const combined = {...statsData, ranked};
    console.log(`[Brawlhalla] Caching valid data for ${resolvedId}`);

    setCached(key, combined);
    return combined;

  } catch (err) {
    console.error(`[Brawlhalla] Failed to fetch player ${resolvedId}`);
    console.error(err);

    const stale = getCached(key, true);

    if (stale) {
      console.warn(`[Brawlhalla] Returning stale cache for ${resolvedId}`);
      return stale;
    }
    throw err;
  }
}

// NEW GUILD
export async function fetchGuildStatsNewAPI(guildId = process.env.BRAWLHALLA_CLAN_ID || '396943') {

  const key = `guild:${guildId}`;
  const hit = getCached(key);

  if (hit) {
    console.log(`[Brawlhalla] Cache hit for guild ${guildId}`);
    return hit;
  }

  try {
    const data = await apiFetch(`https://api.brawlhalla.com/v1/guild/stats?guild_id=${guildId}`);

    // Validar os dados
    if (!data || typeof data !== 'object') throw new Error('Invalid guild response');
    if (Object.keys(data).length === 0) throw new Error('Empty guild response');
    if (!data.name) throw new Error('Missing guild name');

    // Normalizar os dados
    data.name = normalizeUnicode(data.name);

    if (data.notice) data.notice = normalizeUnicode(data.notice);

    console.log(`[Brawlhalla] Caching valid guild data for ${guildId}`);

    setCached(key, data);
    return data;

  } catch (err) {
    console.error(`[Brawlhalla] Failed to fetch guild ${guildId}`);
    console.error(err);
    const stale = getCached(key, true);

    if (stale) {
      console.warn(`[Brawlhalla] Returning stale cache for guild ${guildId}`);
      return stale;
    }

    throw err;
  }
}

// builders de embed

export function createStatsEmbed(playerData) {
  const stats = playerData || {};
  const ranked = stats.ranked || {};
  const legends = stats.legends || [];

  const rankIcon = getRankIcon(ranked.tier);

  const mostPlayedLegend = legends.length
    ? legends.reduce((a, b) => ((b.matchtime || 0) > (a.matchtime || 0) ? b : a))
    : null;

  let displayLegendName = 'Unknown';
  let legendIcon = '❓';
  if (mostPlayedLegend) {
    const key = cleanLegendName(mostPlayedLegend.legend_name_key);
    displayLegendName = LEGEND_NAMES[key] || mostPlayedLegend.legend_name_key || 'Unknown';
    legendIcon = LEGEND_EMOJIS[key] || '❓';
  }

  const totalPlaytime = legends.reduce((s, l) => s + parseInt(l.matchtime || 0), 0);

  // logica para playtime de weapon
  const weaponTimes = {};
  legends.forEach(l => {
    const mapping = legendsDataCache?.[l.legend_name_key];
    if (mapping) {
      const w1 = mapping.weapon_one;
      const w2 = mapping.weapon_two;
      const t1 = parseInt(l.timeheldweaponone || 0);
      const t2 = parseInt(l.timeheldweapontwo || 0);
      if (w1) weaponTimes[w1] = (weaponTimes[w1] || 0) + t1;
      if (w2) weaponTimes[w2] = (weaponTimes[w2] || 0) + t2;
    }
  });

  let topWeapon = 'Unknown';
  let topWeaponTime = 0;
  for (const [w, t] of Object.entries(weaponTimes)) {
    if (t > topWeaponTime) {
      topWeapon = w;
      topWeaponTime = t;
    }
  }

  const weaponIcon = WEAPON_ICONS[topWeapon.toLowerCase().replace(/\s+/g, '')] || '❓';

  const totalKos = legends.reduce((s, l) => s + parseInt(l.kos || 0), 0);
  const totalFalls = legends.reduce((s, l) => s + parseInt(l.falls || 0), 0);
  const totalSuicides = legends.reduce((s, l) => s + parseInt(l.suicides || 0), 0);
  const totalTeamKos = legends.reduce((s, l) => s + parseInt(l.teamkos || 0), 0);
  const totalDealt = legends.reduce((s, l) => s + parseInt(l.damagedealt || 0), 0);
  const totalTaken = legends.reduce((s, l) => s + parseInt(l.damagetaken || 0), 0);

  const events = totalKos + totalFalls;
  const koRate = events > 0 ? ((totalKos / events) * 100).toFixed(1) : 0;
  const fallRate = events > 0 ? ((totalFalls / events) * 100).toFixed(1) : 0;
  const totalDmg = totalDealt + totalTaken;
  const dealtPct = totalDmg > 0 ? ((totalDealt / totalDmg) * 100).toFixed(1) : 0;
  const takenPct = totalDmg > 0 ? ((totalTaken / totalDmg) * 100).toFixed(1) : 0;

  const wins = stats.wins || 0;
  const games = stats.games || 0;
  const losses = games - wins;
  const winRatio = games > 0 ? ((wins / games) * 100).toFixed(1) : '0.0';
  const rating = ranked.rating || 'Unranked';
  const tier = ranked.tier || 'N/A';
  const mostLegendTime = mostPlayedLegend ? parseInt(mostPlayedLegend.matchtime || 0) : 0;

  const embedFields = [
    {
      name: '📊 Main Stats',
      value:
        `**Level:** \`${stats.level || 0}\` · **XP:** \`${formatNumber(stats.xp || 0)}\`\n` +
        `**Playtime:** \`${formatTime(totalPlaytime)}\`\n` +
        `**Rating:** \`${typeof rating === 'number' ? formatNumber(rating) : rating}\` · **Tier:** \`${tier}\``,
      inline: false
    },
    {
      name: '⚔️ Overall Record',
      value: `\`${formatNumber(wins)} W\` · \`${formatNumber(losses)} L\` · \`${formatNumber(games)} games\` (\`${winRatio}%\`)`,
      inline: false
    },
    {
      name: '🏆 Most Played Legend',
      value: mostPlayedLegend
        ? `${legendIcon} **${displayLegendName}** — \`${mostPlayedLegend.games} games\` · \`Lv ${mostPlayedLegend.level}\`\nTime: \`${formatTime(mostLegendTime)}\``
        : 'No data',
      inline: false
    },
    {
      name: '🗡️ Main Weapon',
      value: `${weaponIcon} **${normalizeWeapon(topWeapon)}** — \`${formatTime(topWeaponTime)}\``,
      inline: true
    },
    {
      name: '💥 Combat',
      value:
        `**KOs:** \`${formatNumber(totalKos)}\` (\`${koRate}%\`) · **Falls:** \`${formatNumber(totalFalls)}\` (\`${fallRate}%\`)\n` +
        `**Team KOs:** \`${formatNumber(totalTeamKos)}\` · **Suicides:** \`${formatNumber(totalSuicides)}\``,
      inline: false
    },
    {
      name: '📈 Damage',
      value:
        `**Dealt:** \`${formatNumber(totalDealt)}\` (\`${dealtPct}%\`) · **Taken:** \`${formatNumber(totalTaken)}\` (\`${takenPct}%\`)`,
      inline: false
    }
  ];

  return new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`${rankIcon} ${stats.name || 'Player'} (${stats.brawlhalla_id || 'N/A'}) — Brawlhalla Stats`)
    .addFields(embedFields)
    .setFooter({ text: 'Brawlhalla Stats • Geral' })
    .setTimestamp();
}

export function createLegendsStatsEmbed(playerData) {
  const stats = playerData || {};
  const legends = stats.legends || [];

  // Ordena por XP decrescente e pega o top 10
  const topLegends = [...legends]
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 10);

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`🏆 ${stats.name || 'Player'} — Top 10 Legends`)
    .setFooter({ text: 'Brawlhalla Stats • Legends' })
    .setTimestamp();

  if (topLegends.length === 0) {
    embed.setDescription('Nenhum dado de lenda encontrado.');
    return embed;
  }

  const legendList = topLegends.map((l, i) => {
    const key = cleanLegendName(l.legend_name_key);
    const name = LEGEND_NAMES[key] || l.legend_name_key || 'Unknown';
    const icon = LEGEND_EMOJIS[key] || '❓';
    const level = l.level;
    const xpFormatted = formatNumber(l.xp || 0);
    
    return `**${i + 1}.** ${icon} **${name}**\n╰ \`Lv. ${level}\` — \`${xpFormatted} XP\``;
  }).join('\n\n');

  embed.setDescription(legendList);
  return embed;
}

export function createWeaponsStatsEmbed(playerData) {
  const stats = playerData || {};
  const legends = stats.legends || [];

  const weaponTimes = {};
  legends.forEach(l => {
    const mapping = legendsDataCache?.[l.legend_name_key];
    if (mapping) {
      const w1 = mapping.weapon_one;
      const w2 = mapping.weapon_two;
      const t1 = parseInt(l.timeheldweaponone || 0);
      const t2 = parseInt(l.timeheldweapontwo || 0);
      if (w1) weaponTimes[w1] = (weaponTimes[w1] || 0) + t1;
      if (w2) weaponTimes[w2] = (weaponTimes[w2] || 0) + t2;
    }
  });

  // Ordena por tempo decrescente
  const topWeapons = Object.entries(weaponTimes)
    .map(([weapon, time]) => ({ weapon, time }))
    .sort((a, b) => b.time - a.time);

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`🗡️ ${stats.name || 'Player'} — Weapon Playtime`)
    .setFooter({ text: 'Brawlhalla Stats • Weapons' })
    .setTimestamp();

  if (topWeapons.length === 0) {
    embed.setDescription('Nenhum dado de arma encontrado.');
    return embed;
  }

  const weaponList = topWeapons.map((w, i) => {
    const weaponName = normalizeWeapon(w.weapon);
    const icon = WEAPON_ICONS[weaponName.toLowerCase().replace(/\s+/g, '')] || '❓';
    const timeFormatted = formatTime(w.time);
    
    return `**${i + 1}.** ${icon} **${weaponName}**\n╰ \`${timeFormatted}\``;
  }).join('\n\n');

  embed.setDescription(weaponList);
  return embed;
}

export function createRankedEmbed(playerData) {
  const stats = playerData || {};
  const ranked = stats.ranked || {};
  const legendsRanked = ranked.legends || [];
  const teams2v2 = ranked['2v2'] || [];
  const rotating = ranked.rotating_ranked || null;

  const rankIcon = getRankIcon(ranked.tier);

  // 2v2 Solo (brawlhalla_id_two === 0)
  const solo2v2 = teams2v2.find(t => t.brawlhalla_id_two === 0);

  // 2v2 Team
  const bestTeam = teams2v2.length > 0
    ? teams2v2
        .filter(t => t.brawlhalla_id_two !== 0)
        .reduce((a, b) => {
          if (!a) return b;
          return (b.rating || 0) > (a.rating || 0) ? b : a;
        }, null)
    : null;

  // 3v3 (rotating_ranked)
  let rotatingStats = null;
  if (rotating) {
    if (Array.isArray(rotating)) {
      rotatingStats = rotating.reduce((a, b) => ((b.rating || 0) > (a.rating || 0) ? b : a), null);
    } else {
      rotatingStats = rotating;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`${rankIcon} ${stats.name || 'Player'} (${stats.brawlhalla_id || 'N/A'}) — Ranked Data`);

  const rankedFields = [
    {
      name: '🏆 1v1 Ranked',
      value: (() => {
        const w = ranked.wins || 0;
        const g = ranked.games || 0;
        const l = g - w;
        const pct = g > 0 ? ((w / g) * 100).toFixed(1) : '0.0';
        return `**Rating:** \`${formatNumber(ranked.rating || 0)}\` (Peak: \`${formatNumber(ranked.peak_rating || 0)}\`)\n` +
          `**Tier:** \`${ranked.tier || 'N/A'}\`\n` +
          `**Wins:** \`${formatNumber(w)}\` · **Losses:** \`${formatNumber(l)}\` (\`${pct}%\`)`;
      })(),
      inline: false
    }
  ];

  if (solo2v2) {
    const w = solo2v2.wins || 0;
    const g = solo2v2.games || 0;
    const l = g - w;
    const pct = g > 0 ? ((w / g) * 100).toFixed(1) : '0.0';
    rankedFields.push({
      name: '🥋 2v2 Solo',
      value:
        `**Rating:** \`${formatNumber(solo2v2.rating)}\` (Peak: \`${formatNumber(solo2v2.peak_rating)}\`)\n` +
        `**Tier:** \`${solo2v2.tier}\`\n` +
        `**Wins:** \`${formatNumber(w)}\` · **Losses:** \`${formatNumber(l)}\` (\`${pct}%\`)`,
      inline: false
    });
  }

  if (bestTeam) {
    const w = bestTeam.wins || 0;
    const g = bestTeam.games || 0;
    const l = g - w;
    const pct = g > 0 ? ((w / g) * 100).toFixed(1) : '0.0';
    rankedFields.push({
      name: '👯 2v2 Team',
      value:
        `**Team:** \`${bestTeam.teamname}\`\n` +
        `**Rating:** \`${formatNumber(bestTeam.rating)}\` (Peak: \`${formatNumber(bestTeam.peak_rating)}\`)\n` +
        `**Tier:** \`${bestTeam.tier}\`\n` +
        `**Wins:** \`${formatNumber(w)}\` · **Losses:** \`${formatNumber(l)}\` (\`${pct}%\`)`,
      inline: false
    });
  }

  if (rotatingStats) {
    const w = rotatingStats.wins || 0;
    const g = rotatingStats.games || 0;
    const l = g - w;
    const pct = g > 0 ? ((w / g) * 100).toFixed(1) : '0.0';
    rankedFields.push({
      name: '🎨 3v3 Ranked',
      value:
        `**Rating:** \`${formatNumber(rotatingStats.rating)}\` (Peak: \`${formatNumber(rotatingStats.peak_rating)}\`)\n` +
        `**Tier:** \`${rotatingStats.tier}\`\n` +
        `**Wins:** \`${formatNumber(w)}\` · **Losses:** \`${formatNumber(l)}\` (\`${pct}%\`)`,
      inline: false
    });
  }

  embed.addFields(rankedFields);

  return embed
    .setFooter({ text: 'Brawlhalla Stats • Ranked' })
    .setTimestamp();
}

export async function createGuildEmbed(guildData) {
  const guildName = normalizeUnicode(guildData.name || 'Unknown Guild');
  const guildId = guildData.guild_id || 'N/A';
  const createDate = guildData.create_date || 0;
  const xp = (guildData.xp || 0) + (guildData.legacy_xp || 0);
  const guildPoints = guildData.guild_points || 0;
  const rank = guildData.rank || 'N/A';
  const memberCount = guildData.member_count || 0;
  const notice = guildData.notice || 'No notice';
  const discordInvite = guildData.discord_invite_code ? `discord.gg/${guildData.discord_invite_code}` : 'None';

  // Fazer o cálculo dos pontos semanais subtraindo os pontos da semana anterior dos pontos atuais
  const weekEnd = getMissionWeekStart();
  const lastWeekGuildPointsData = await getGuildWeeklyGuildPoints(weekEnd);

  const lastWeekGuildPoints = Number(lastWeekGuildPointsData?.total_guild_points || 0);
  const weeklyGuildPoints = Math.max(0, Number(guildData.guild_points || 0) - lastWeekGuildPoints);

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`🏰 ${guildName} — Guild Stats`)
    .addFields(
      {
        name: '📊 Info',
        value:
          `**Rank Global:** #${formatNumber(rank)}\n` +
          `**Membros:** ${memberCount}/200\n` +
          `**GP Totais:** ${formatNumber(guildPoints)}\n` +
          `**GP Semanal:** ${formatNumber(weeklyGuildPoints || 0)}\n` +
          `**XP:** ${formatNumber(xp)}\n` +
          `**Criada em:** ${createDate ? new Date(createDate * 1000).toLocaleDateString('pt-BR') : 'N/A'}`,
        inline: false
      },
      {
        name: '📢 Mensagem do Dia',
        value: notice,
        inline: false
      },
      {
        name: '💬 Discord',
        value: discordInvite,
        inline: false
      }
    )
    .setFooter({text: 'Brawlhalla Guild Stats • TGG Bot'})
    .setTimestamp();
}

export function clearCache() {
  // limpa o cache
  try {
    const files = readdirSync(CACHE_DIR);
    for (const file of files) unlinkSync(resolve(CACHE_DIR, file));
  } catch { }
  legendsDataCache = null;
}

// inicialização
fetchLegends().catch(err => console.warn('[Brawlhalla] Pre-warm legends failed:', err.message));
