

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { brawlhalla } from '../config/index.js';
import { getUsersByBrawlhallaIds } from './db.js';
import { loadCustomNicknames, saveCustomNicknames, getCustomNickname, setCustomNickname } from './customNicknames.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAN_CACHE_FILE = path.join(__dirname, '..', '.brawlhalla-clan-cache.json');


function fixBrawlhallaName(str) {
  if (!str || typeof str !== 'string') return str;

  try {
    return decodeURIComponent(escape(str));
  } catch (e) {
    return str;
  }
}

/**
 * Sanitize clan data to fix encoding issues in member names
 * @param {Object} clanData - Raw clan data from API
 * @returns {Object} Clan data with fixed encoding
 */
function sanitizeClanData(clanData) {
  if (!clanData || !clanData.clan) return clanData;

  return {
    ...clanData,
    clan: clanData.clan.map((member) => ({
      ...member,
      name: fixBrawlhallaName(member.name),
    })),
  };
}

function normalizeText(str) {
  if (!str) return '';

  return str
    .normalize('NFC')
    .replace(/[\u115F\u1160\u3164]/g, '')     
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '') 
    .replace(/\s+/g, ' ')
    .trim();
}


export async function fetchBrawlhallaClanData() {
  if (!brawlhalla.apiKey) {
    throw new Error('BRAWLHALLA_API_KEY not set in .env');
  }

  const url = `https://api.brawlhalla.com/clan/${brawlhalla.clanId}?api_key=${process.env.BRAWLHALLA_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Brawlhalla API error: ${response.status} ${response.statusText}`);
    }

    let data = await response.json();
    if (!data.clan || !Array.isArray(data.clan)) {
      throw new Error('Invalid clan data: no clan array in response');
    }

    
    data = sanitizeClanData(data);

    await saveClanCache(data);
    return data;
  } catch (err) {
    console.error(`[CLAN FETCH ERROR] ${err.message}`);
    throw err;
  }
}

export async function saveClanCache(clanData) {
  try {
    await fs.writeFile(CLAN_CACHE_FILE, JSON.stringify(clanData, null, 2), 'utf8');
    console.log(`[CLAN CACHE] Saved clan data to ${CLAN_CACHE_FILE}`);
  } catch (err) {
    console.error(`[CLAN CACHE ERROR] Failed to save:`, err.message);
    throw err;
  }
}


export async function loadClanCache() {
  try {
    const data = await fs.readFile(CLAN_CACHE_FILE, 'utf8');
    let clanData = JSON.parse(data);
   
    clanData = sanitizeClanData(clanData);
    clanData._fromCache = true; 
    console.log(`[CLAN CACHE] Loaded clan data from cache`);
    return clanData;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    console.error(`[CLAN CACHE ERROR] Failed to load:`, err.message);
    return null;
  }
}


export function buildNickname(brawlhallaName, discordName) {
 
  return brawlhallaName.length > 32 ? null : brawlhallaName;
}



export function parseNickname(nickname) {
  if (!nickname || typeof nickname !== 'string') return null;
  const parts = nickname.split('/');
  if (parts.length !== 2) return null;
  return { brawlhallaName: parts[0].trim(), discordName: parts[1].trim() };
}


export function getDiscordNameForMember(member, discord_id) {
  const customName = getCustomNickname(discord_id);
  if (customName) return customName;
  return member.user.username;
}


export async function syncNicknames(client, guildId) {
  const results = {
    synced: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    errors: [],
    results: []
  };

  try {
   
    await loadCustomNicknames();

    
    console.log('[CLAN CACHE] Checking for cached clan data...');
    let clanResponse = await loadClanCache();
    
    
    if (!clanResponse) {
      console.log('[CLAN API] No cache found, fetching from Brawlhalla API...');
      clanResponse = await fetchBrawlhallaClanData();
    } else {
      console.log('[CLAN CACHE] Using cached clan data');
    }
    
    const clanMembers = clanResponse.clan || [];
    console.log(`[CLAN DATA] Loaded ${clanMembers.length} clan members`);

  
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      throw new Error(`Guild ${guildId} not found`);
    }

   
    const brawlhallaIds = clanMembers.map((m) => m.brawlhalla_id);
    const userMappings = await getUsersByBrawlhallaIds(brawlhallaIds);

    console.log(`\n--- Nickname Sync Start ---`);
    console.log(`Guild: ${guild.name} (${guild.id})`);
    console.log(`Clan members: ${clanMembers.length}`);
    console.log(`Users matched in database: ${userMappings.size}\n`);

  
    let processedCount = 0;
    let skippedCount = 0;
    for (const clanMember of clanMembers) {
      let { brawlhalla_id, name } = clanMember;
      const brawlhallaName = normalizeText(name);
      
      
      const brawlhallaIdStr = String(brawlhalla_id);
      let userMapping = userMappings.get(brawlhalla_id);
      if (!userMapping) {
        userMapping = userMappings.get(brawlhallaIdStr);
      }
      if (!userMapping) {
        skippedCount++;
        // console.warn(`[SKIP] Brawlhalla ID ${brawlhalla_id} not in database`);
        continue;
      }
      
      processedCount++;

      const discord_id = userMapping.discord_id;

      try {

        let member;
        try {
          member = await guild.members.fetch(discord_id);
        } catch (fetchErr) {
          console.warn(`[NOT IN GUILD] Discord ID ${discord_id} (Brawlhalla: "${brawlhallaName}") - ${fetchErr.message}`);
          results.errors.push({
            discord_id,
            brawlhalla_id,
            brawlhallaName,
            error: `Member not in guild: ${fetchErr.message}`
          });
          results.failed++;
          continue;
        }
        
        if (!member) {
          console.warn(`[NOT IN GUILD] Discord ID ${discord_id} (Brawlhalla: "${brawlhallaName}")`);
          results.errors.push({
            discord_id,
            brawlhalla_id,
            brawlhallaName,
            error: 'Member not in guild (null returned)'
          });
          results.failed++;
          continue;
        }


        const discordName = getDiscordNameForMember(member, discord_id);


        const newNickname = buildNickname(brawlhallaName, discordName);
        if (!newNickname) {
          console.warn(`[SKIP] "${brawlhallaName}/${discordName}" exceeds 32 chars`);
          results.errors.push({
            discord_id,
            brawlhalla_id,
            brawlhallaName,
            discordName,
            error: 'Nickname exceeds 32 characters'
          });
          results.failed++;
          continue;
        }


        const currentNickname = normalizeText(member.nickname || '');
        const finalNickname   = normalizeText(newNickname);

        if (currentNickname === finalNickname) {
          console.log(`[OK] ${member.user.tag} (${discord_id}): nickname already "${newNickname}"`);
          results.unchanged++;
        } else {

          try {
            await member.setNickname(newNickname);
            console.log(`[UPDATE] ${member.user.tag} (${discord_id}): "${currentNickname || member.user.username}" → "${newNickname}"`);
            results.updated++;
          } catch (setNickErr) {
            console.error(`[NICKNAME SET ERROR] ${member.user.tag} (${discord_id}): ${setNickErr.message}`);
            console.error(`[NICKNAME SET ERROR] Attempted: "${newNickname}"`);
            throw setNickErr;
          }
        }

        results.synced++;
        results.results.push({
          discord_id,
          brawlhalla_id,
          username: member.user.username,
          brawlhallaName,
          nickname: newNickname,
          status: currentNickname === newNickname ? 'unchanged' : 'updated'
        });
      } catch (err) {
        console.error(`[SYNC ERROR] Discord ${discord_id} (Brawlhalla: ${brawlhalla_id}): ${err.message}`);
        if (err.stack) {
          console.error(`[SYNC ERROR] Stack: ${err.stack}`);
        }
        results.errors.push({
          discord_id,
          brawlhalla_id,
          error: err.message
        });
        results.failed++;
      }
    }

    console.log('\n--- Nickname Sync Summary ---');
    console.log(`Processed from database: ${processedCount}`);
    console.log(`Skipped (not in database): ${skippedCount}`);
    console.log(`Total synced: ${results.synced}`);
    console.log(`Updated: ${results.updated}`);
    console.log(`Unchanged: ${results.unchanged}`);
    console.log(`Failed: ${results.failed}`);
    const dataSource = clanResponse._fromCache ? '📦 Cache' : '🔄 Brawlhalla API';
    console.log(`Data source: ${dataSource}`);
    if (results.errors.length > 0) {
      console.log(`\nErrors (showing first 10):`);
      results.errors.slice(0, 10).forEach((e) => console.log(`  • ${e.discord_id}: ${e.error}`));
    }
    console.log('--- Sync Done ---\n');
  } catch (err) {
    console.error(`[SYNC ERROR] ${err.message}`);
    results.errors.push({ error: err.message });
  }

  return results;
}


export async function updateMemberNicknameDiscordPortion(member, newDiscordName) {
  try {
    const currentNickname = member.nickname;
    let brawlhallaName = member.user.username; // fallback

  
    if (currentNickname) {
      const parsed = parseNickname(currentNickname);
      if (parsed) {
        brawlhallaName = parsed.brawlhallaName;
      }
    }


    const newNickname = buildNickname(brawlhallaName, newDiscordName);
    if (!newNickname) {
      throw new Error(`New nickname would exceed 32 characters: ${brawlhallaName}/${newDiscordName}`);
    }

    await member.setNickname(newNickname);
    console.log(`[NICKNAME UPDATE] ${member.user.tag}: "${currentNickname || member.user.username}" → "${newNickname}"`);


    setCustomNickname(member.id, newDiscordName);
    await saveCustomNicknames();

    return true;
  } catch (err) {
    console.error(`[NICKNAME UPDATE ERROR]: ${err.message}`);
    throw err;
  }
}

export { loadCustomNicknames, saveCustomNicknames };
