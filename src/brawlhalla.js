
import { EmbedBuilder } from 'discord.js';
import { getUserByDiscordId } from './db.js';

const CACHE_DURATION = 15 * 60 * 1000;
const statsCache = new Map();
const clanCache = new Map();


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
  'gauntlets': '<:Gauntlets:1480882496764907642>',
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

const REGION_ICONS = {
  'USW': '<:USW:1480883842851278928>',
  'USE': '<:USE:1480883841169358888>',
  'SEA': '<:SEA:1480883839587975331>',
  'SA': '<:SA:1480883837981560936>',
  'ME': '<:ME:1480883836307898378>',
  'JPN': '<:JPN:1480883834357809233>',
  'EU': '<:EU:1480883832361193504>',
  'BRZ': '<:BRZ:1480883830343598223>',
  'AUS': '<:AUS:1480883828351307827>',
  'ALL': '<:ALL:1480883826132779080>'
};

// Legend display names with proper unicode support
const LEGEND_NAMES = {
  bodvar: 'Bödvar',
  cassidy: 'Cassidy',
  orion: 'Orion',
  lordvraxx: 'Lord Vraxx',
  gnash: 'Gnash',
  queennai: 'Queen Nai',
  hattori: 'Hattori',
  thatch: 'Thatch',
  ada: 'Ada',
  scarlet: 'Scarlet',
  sentinel: 'Sentinel',
  sirroland: 'Sir Roland',
  lucien: 'Lucien',
  teros: 'Teros',
  brynn: 'Brynn',
  asuri: 'Asuri',
  barraza: 'Barraza',
  ember: 'Ember',
  azoth: 'Azoth',
  koji: 'Koji',
  ulgrim: 'Ulgrim',
  diana: 'Diana',
  jhala: 'Jhala',
  kor: 'Kor',
  wushang: 'Wu Shang',
  val: 'Val',
  ragnir: 'Ragnir',
  cross: 'Cross',
  mirage: 'Mirage',
  nix: 'Nix',
  mordex: 'Mordex',
  yumiko: 'Yumiko',
  artemis: 'Artemis',
  caspian: 'Caspian',
  sidra: 'Sidra',
  xull: 'Xull',
  kaya: 'Kaya',
  isaiah: 'Isaiah',
  jiro: 'Jiro',
  linfei: 'Lin Fei',
  zariel: 'Zariel',
  rayman: 'Rayman',
  dusk: 'Dusk',
  fait: 'Fait',
  thor: 'Thor',
  petra: 'Petra',
  vector: 'Vector',
  volkov: 'Volkov',
  onyx: 'Onyx',
  jaeyun: 'Jaeyun',
  mako: 'Mako',
  magyar: 'Magyar',
  reno: 'Reno',
  munin: 'Munin',
  arcadia: 'Arcadia',
  ezio: 'Ezio',
  tezca: 'Tezca',
  thea: 'Thea',
  redraptor: 'Red Raptor',
  loki: 'Loki',
  seven: 'Seven',
  vivi: 'Vivi',
  imugi: 'Imugi',
  kingzuva: 'King Zuva',
  priya: 'Priya',
  ransom: 'Ransom',
  ladyvera: 'Lady Vera',
  rupture: 'Rupture'
};


function getCacheKey(type, id) {
  return `${type}:${id}`;
}

function isCacheValid(timestamp) {
  return Date.now() - timestamp < CACHE_DURATION;
}


function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0h 0m 0s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Clean legend name by removing special characters and normalizing
function cleanLegendName(name) {
  if (!name) return '';
  // Remove special characters, keep only alphanumeric and spaces
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '');
}


function getLegendName(legendId) {
  const legendMap = {
    0: 'bodvar',
    1: 'cassidy',
    2: 'orion',
    3: 'lord vraxx',
    4: 'gnash',
    5: 'queen nai',
    6: 'hattori',
    7: 'thatch',
    8: 'ada',
    9: 'scarlet',
    10: 'sentinel',
    11: 'sir roland',
    12: 'lucien',
    13: 'teros',
    14: 'brynn',
    15: 'asuri',
    16: 'barraza',
    17: 'ember',
    18: 'azoth',
    19: 'koji',
    20: 'ulgrim',
    21: 'diana',
    22: 'jhala',
    23: 'kor',
    24: 'wu shang',
    25: 'val',
    26: 'ragnir',
    27: 'cross',
    28: 'mirage',
    29: 'nix',
    30: 'mordex',
    31: 'yumiko',
    32: 'artemis',
    33: 'caspian',
    34: 'sidra',
    35: 'xull',
    36: 'kaya',
    37: 'isaiah',
    38: 'jiro',
    39: 'lin fei',
    40: 'zariel',
    41: 'rayman',
    42: 'dusk',
    43: 'fait',
    44: 'thor',
    45: 'petra',
    46: 'vector',
    47: 'volkov',
    48: 'onyx',
    49: 'jaeyun',
    50: 'mako',
    51: 'magyar',
    52: 'reno',
    53: 'munin',
    54: 'arcadia',
    55: 'ezio',
    56: 'tezca',
    57: 'thea',
    58: 'red raptor',
    59: 'loki',
    60: 'seven',
    61: 'vivi',
    62: 'imugi',
    63: 'king zuva',
    64: 'priya',
    65: 'ransom',
    66: 'lady vera',
    67: 'rupture'
  };
  return legendMap[legendId] || 'unknown';
}

function getWeaponName(weaponId) {
  const weaponMap = {
    0: 'sword', 1: 'greatsword', 2: 'spear', 3: 'katars',
    4: 'axe', 5: 'bow', 6: 'hammer', 7: 'blasters',
    8: 'rocketlance', 9: 'scythe', 10: 'gauntlets', 11: 'orb',
    12: 'cannon', 13: 'unarmed', 14: 'battleboots', 15: 'chakram',
    16: 'grapplehammer'
  };
  return weaponMap[weaponId] || 'unknown';
}

function getRankIcon(tier) {
  if (!tier) return '❓';
  const tierLower = tier.toLowerCase().replace(/\s+/g, '');
  return RANK_ICONS[tierLower] || '❓';
}



// Normalize unicode strings to proper UTF-8 representation
function normalizeUnicode(str) {
  if (!str || typeof str !== 'string') return str;

  // Try the decodeURIComponent(escape(str)) trick for common mojibake
  try {
    return decodeURIComponent(escape(str));
  } catch (e) {
    // Fallback to basic normalization
    return str.normalize('NFC');
  }
}

let legendsDataCache = null;

async function fetchLegends() {
  if (legendsDataCache) return legendsDataCache;

  try {
    const response = await fetch(`https://api.brawlhalla.com/legend/all?api_key=${process.env.BRAWLHALLA_API_KEY}`);
    if (response.ok) {
      const data = await response.json();
      legendsDataCache = {};
      data.forEach(legend => {
        legendsDataCache[legend.legend_name_key] = {
          weapon_one: legend.weapon_one,
          weapon_two: legend.weapon_two
        };
      });
      return legendsDataCache;
    }
  } catch (err) {
    console.error('Error fetching legends mapping:', err);
  }
  return null;
}

export async function fetchPlayerStats(brawlhallaId) {
  const cacheKey = getCacheKey('stats', brawlhallaId);
  const cached = statsCache.get(cacheKey);

  if (cached && isCacheValid(cached.timestamp)) {
    return cached.data;
  }

  try {
    // Fetch legends mapping if not already cached
    if (!legendsDataCache) {
      await fetchLegends();
    }

    // Fetch both stats and ranked data
    const [statsRes, rankedRes] = await Promise.all([
      fetch(`https://api.brawlhalla.com/player/${brawlhallaId}/stats?api_key=${process.env.BRAWLHALLA_API_KEY}`),
      fetch(`https://api.brawlhalla.com/player/${brawlhallaId}/ranked?api_key=${process.env.BRAWLHALLA_API_KEY}`)
    ]);

    if (!statsRes.ok || !rankedRes.ok) {
      throw new Error(`API Error: ${statsRes.status || rankedRes.status}`);
    }

    let statsData = await statsRes.json();
    const rankedData = await rankedRes.json();

    // Sanitize names in statsData
    if (statsData.name) {
      statsData.name = normalizeUnicode(statsData.name);
    }
    if (statsData.clan && statsData.clan.clan_name) {
      statsData.clan.clan_name = normalizeUnicode(statsData.clan.clan_name);
    }

    // Merge ranked data with stats
    const combinedData = { ...statsData, ranked: rankedData };

    // Cache the response
    statsCache.set(cacheKey, {
      data: combinedData,
      timestamp: Date.now()
    });

    return combinedData;
  } catch (error) {
    console.error('Error fetching player stats:', error);
    throw error;
  }
}

// Fetch clan stats from Brawlhalla API
export async function fetchClanStats(clanId = process.env.BRAWLHALLA_CLAN_ID || '396943') {
  const cacheKey = getCacheKey('clan', clanId);
  const cached = clanCache.get(cacheKey);

  if (cached && isCacheValid(cached.timestamp)) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `https://api.brawlhalla.com/clan/${clanId}?api_key=${process.env.BRAWLHALLA_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    let data = await response.json();

    // Sanitize clan and member names
    if (data.clan_name) {
      data.clan_name = normalizeUnicode(data.clan_name);
    }
    if (data.clan && Array.isArray(data.clan)) {
      data.clan = data.clan.map(member => ({
        ...member,
        name: normalizeUnicode(member.name)
      }));
    }

    clanCache.set(cacheKey, {
      data: data,
      timestamp: Date.now()
    });

    return data;
  } catch (error) {
    console.error('Error fetching clan stats:', error);
    throw error;
  }
}


export function createStatsEmbed(playerData) {
  const stats = playerData || {};

  // Get ranked data
  const ranked = stats.ranked || {};
  const rankIcon = getRankIcon(ranked.tier);

  // Get legends list
  const legends = stats.legends || [];

  // Find most played legend (by games)
  const mostPlayedLegend = legends.length
    ? legends.reduce((prev, current) => ((current.games || 0) > (prev.games || 0)) ? current : prev)
    : null;

  // Get legend name and icon
  let displayLegendName = 'Unknown';
  let legendIcon = '❓';
  if (mostPlayedLegend) {
    const legendKey = cleanLegendName(mostPlayedLegend.legend_name_key);
    displayLegendName = LEGEND_NAMES[legendKey] || mostPlayedLegend.legend_name_key || 'Unknown';
    legendIcon = LEGEND_ICONS[legendKey] || '❓';
  }

  // Calculate total playtime from all legends (matchtime is in seconds)
  let totalPlaytime = 0;
  legends.forEach(legend => {
    totalPlaytime += parseInt(legend.matchtime || 0);
  });

  // Get most played weapon for that legend
  let weaponOneStats = parseInt(mostPlayedLegend?.timeheldweaponone || 0);
  let weaponTwoStats = parseInt(mostPlayedLegend?.timeheldweapontwo || 0);
  let weaponName = 'Unknown';
  let weaponIcon = '❓';

  if (mostPlayedLegend) {
    const legendKey = cleanLegendName(mostPlayedLegend.legend_name_key);
    const legendMapping = legendsDataCache ? legendsDataCache[mostPlayedLegend.legend_name_key] : null;

    if (weaponOneStats > weaponTwoStats) {
      weaponName = legendMapping?.weapon_one || 'Weapon One';
    } else if (weaponTwoStats > 0) {
      weaponName = legendMapping?.weapon_two || 'Weapon Two';
    }

    // Attempt to get weapon icon
    const cleanWepName = weaponName.toLowerCase().replace(/\s+/g, '');
    weaponIcon = WEAPON_ICONS[cleanWepName] || '❓';
  }

  // Aggregate stats from all legends
  let totalDamageDealt = 0;
  let totalDamageTaken = 0;
  let totalKos = 0;
  let totalFalls = 0;
  let totalSuicides = 0;
  let totalTeamKos = 0;

  legends.forEach(legend => {
    totalDamageDealt += parseInt(legend.damagedealt || 0);
    totalDamageTaken += parseInt(legend.damagetaken || 0);
    totalKos += parseInt(legend.kos || 0);
    totalFalls += parseInt(legend.falls || 0);
    totalSuicides += parseInt(legend.suicides || 0);
    totalTeamKos += parseInt(legend.teamkos || 0);
  });

  // Calculate percentages
  const totalDamageEvents = totalKos + totalFalls;
  const koRate = totalDamageEvents > 0 ? ((totalKos / totalDamageEvents) * 100).toFixed(1) : 0;
  const fallRate = totalDamageEvents > 0 ? ((totalFalls / totalDamageEvents) * 100).toFixed(1) : 0;

  const totalDamage = totalDamageDealt + totalDamageTaken;
  const damageDealtPct = totalDamage > 0 ? ((totalDamageDealt / totalDamage) * 100).toFixed(1) : 0;
  const damageTakenPct = totalDamage > 0 ? ((totalDamageTaken / totalDamage) * 100).toFixed(1) : 0;

  // Get win/loss and rating
  const wins = stats.wins || 0;
  const games = stats.games || 0;
  const losses = games - wins;
  const winRate = games > 0 ? ((wins / games) * 100).toFixed(1) : 0;
  const rating = ranked.rating || 'Unranked';
  const tier = ranked.tier || 'N/A';

  // Calculate most played legend's playtime
  const mostLegendPlaytime = mostPlayedLegend ? parseInt(mostPlayedLegend.matchtime || 0) : 0;

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`${rankIcon} ${stats.name || 'Player'} - Brawlhalla Stats`)
    .addFields(
      {
        name: '📊 Main Stats',
        value: `**Level:** ${stats.level || 0}\n` +
          `**Total XP:** ${formatNumber(stats.xp || 0)}\n` +
          `**Total Playtime:** ${formatTime(totalPlaytime)}\n` +
          `**Rating:** ${typeof rating === 'number' ? formatNumber(rating) : rating}\n` +
          `**Tier:** ${tier}`,
        inline: false
      },
      {
        name: '⚔️ Overall Record',
        value: `${formatNumber(wins)} Wins • ${formatNumber(losses)} Losses\n` +
          `${formatNumber(games)} Games (${winRate}%)`,
        inline: false
      },
      {
        name: '🏆 Most Played Legend',
        value: mostPlayedLegend
          ? `${legendIcon} **${displayLegendName}**\nGames: ${mostPlayedLegend.games} • Level: ${mostPlayedLegend.level}\nTime: ${formatTime(mostLegendPlaytime)}`
          : 'No data available',
        inline: false
      },
      {
        name: '⚔️ Most Played Weapon',
        value: `${weaponIcon} **${weaponName}**`,
        inline: true
      },
      {
        name: '💥 Damage Stats',
        value: `**KOs:** ${formatNumber(totalKos)} • **Falls:** ${formatNumber(totalFalls)}\n` +
          `**KO Rate:** ${koRate}% • **Fall Rate:** ${fallRate}%\n` +
          `**Suicides:** ${formatNumber(totalSuicides)}\n` +
          `**Team KOs:** ${formatNumber(totalTeamKos)}`,
        inline: false
      },
      {
        name: '🎯 Damage Breakdown',
        value: `**Damage Dealt:** ${formatNumber(totalDamageDealt)} (${damageDealtPct}%)\n` +
          `**Damage Taken:** ${formatNumber(totalDamageTaken)} (${damageTakenPct}%)`,
        inline: false
      }
    )
    .setFooter({ text: 'Brawlhalla Stats • TGG Bot' })
    .setTimestamp();

  return embed;
}

// Create clan embed
export function createClanEmbed(clanData) {
  const clanName = normalizeUnicode(clanData.clan_name || 'Unknown Clan');
  const clanId = clanData.clan_id || 'N/A';
  const clanCreateDate = clanData.clan_create_date || 0;
  const totalClanXp = clanData.clan_lifetime_xp || 0;

  // Members are in the 'clan' array, not 'members'
  const members = clanData.clan || [];

  // Sort members by XP (descending)
  const topMembers = members
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 10);

  const totalMemberXp = members.reduce((sum, member) => sum + (member.xp || 0), 0);

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`🏰 ${clanName} - Clan Stats`)
    .addFields(
      {
        name: '📊 Clan Information',
        value: `**Clan ID:** ${clanId}\n` +
          `**Created:** ${clanCreateDate ? new Date(clanCreateDate * 1000).toLocaleDateString('pt-BR') : 'N/A'}\n` +
          `**Members:** ${members.length}/100\n` +
          `**Total Clan XP:** ${formatNumber(totalClanXp)}`,
        inline: false
      },
      {
        name: '🏆 Top Members',
        value: topMembers.length > 0
          ? topMembers
            .map((member, index) => {
              const rankEmoji = member.rank === 'Leader' ? '👑' : member.rank === 'Officer' ? '⚔️' : '🗡️';
              // Ensure proper UTF-8 normalization for member names with special characters
              const memberName = normalizeUnicode(member.name || 'Unknown').trim();
              return `**${index + 1}.** ${rankEmoji} ${memberName}\nXP: ${formatNumber(member.xp || 0)}`;
            })
            .join('\n')
          : 'No members found',
        inline: false
      }
    )
    .setFooter({ text: 'Brawlhalla Clan Stats • TGG Bot' })
    .setTimestamp();

  return embed;
}

// Get user's Brawlhalla ID from database
export async function getUserBrawlhallaId(discordId) {
  try {
    const user = await getUserByDiscordId(discordId);
    return user?.brawlhalla_id;
  } catch (error) {
    console.error('Error getting user Brawlhalla ID:', error);
    return null;
  }
}

// Clear cache (for testing or force refresh)
export function clearCache() {
  statsCache.clear();
  clanCache.clear();
}
