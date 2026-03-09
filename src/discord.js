// sincroniza cargos: guild rank (recruit/member/officer) e elo roles

import { Client, GatewayIntentBits } from 'discord.js';

// mapeamento db role -> discord role id
const ROLE_MAP = {
  recruit: '1437427750209327297',
  member: '1437427716805890191',
  officer: '1437427655950467242',
  admin: '1437427655950467242', // same as officer
};

// todos os guild rank role ids
export const ALL_GUILD_ROLE_IDS = Object.values(ROLE_MAP);

// cargos do sistema independentes
export const SYSTEM_ROLES = {
  TGG: '1437441679572471940',
  VISITOR: '1437447173896802395',
  WAITING_LIST: '1466815420630565069',
  PENDING: '1478477041077588098',
};

// nomes para debug
const ROLE_ID_TO_NAME = {
  '1437427750209327297': 'recruit',
  '1437427716805890191': 'member',
  '1437427655950467242': 'officer',
  '1437441679572471940': 'TGG',
  '1437447173896802395': 'Visitante',
  '1466815420630565069': 'Fila de espera',
  '1478477041077588098': 'Pendente',
};

// ranks de elo (diamond ate tin 0)
const ELO_ROLES = [
  { minElo: 3000, roleId: '1445053516144971776', name: 'Diamond 10' },
  { minElo: 2900, roleId: '1445053513251164160', name: 'Diamond 9' },
  { minElo: 2800, roleId: '1445053510495502377', name: 'Diamond 8' },
  { minElo: 2700, roleId: '1445053505760133270', name: 'Diamond 7' },
  { minElo: 2600, roleId: '1445053265703207132', name: 'Diamond 6' },
  { minElo: 2500, roleId: '1445053263790608524', name: 'Diamond 5' },
  { minElo: 2400, roleId: '1445053261265502299', name: 'Diamond 4' },
  { minElo: 2300, roleId: '1445053258916696124', name: 'Diamond 3' },
  { minElo: 2200, roleId: '1445053255091752971', name: 'Diamond 2' },
  { minElo: 2100, roleId: '1445053243662270545', name: 'Diamond 1' },
  { minElo: 2000, roleId: '1437505069166629030', name: 'Diamond' },
  { minElo: 1936, roleId: '1448450833120231484', name: 'Platinum 5' },
  { minElo: 1872, roleId: '1448450845082386462', name: 'Platinum 4' },
  { minElo: 1808, roleId: '1448450841848713327', name: 'Platinum 3' },
  { minElo: 1744, roleId: '1448450838258257973', name: 'Platinum 2' },
  { minElo: 1680, roleId: '1437505160891863110', name: 'Platinum 1' },
  { minElo: 1622, roleId: '1475193344937169049', name: 'Gold 5' },
  { minElo: 1564, roleId: '1475193228281250036', name: 'Gold 4' },
  { minElo: 1506, roleId: '1475193238364356690', name: 'Gold 3' },
  { minElo: 1448, roleId: '1475193242495483914', name: 'Gold 2' },
  { minElo: 1390, roleId: '1475193246018699377', name: 'Gold 1' },
  { minElo: 1338, roleId: '1475193997658951841', name: 'Silver 5' },
  { minElo: 1286, roleId: '1475193994689384579', name: 'Silver 4' },
  { minElo: 1234, roleId: '1475193990809915473', name: 'Silver 3' },
  { minElo: 1182, roleId: '1475193987127181432', name: 'Silver 2' },
  { minElo: 1130, roleId: '1475193930097099023', name: 'Silver 1' },
  { minElo: 1086, roleId: process.env.ELO_ROLE_BRONZE_5 || '', name: 'Bronze 5' },
  { minElo: 1042, roleId: process.env.ELO_ROLE_BRONZE_4 || '', name: 'Bronze 4' },
  { minElo: 998, roleId: process.env.ELO_ROLE_BRONZE_3 || '', name: 'Bronze 3' },
  { minElo: 954, roleId: process.env.ELO_ROLE_BRONZE_2 || '', name: 'Bronze 2' },
  { minElo: 910, roleId: process.env.ELO_ROLE_BRONZE_1 || '', name: 'Bronze 1' },
  { minElo: 872, roleId: process.env.ELO_ROLE_TIN_5 || '', name: 'Tin 5' },
  { minElo: 834, roleId: process.env.ELO_ROLE_TIN_4 || '', name: 'Tin 4' },
  { minElo: 796, roleId: process.env.ELO_ROLE_TIN_3 || '', name: 'Tin 3' },
  { minElo: 758, roleId: process.env.ELO_ROLE_TIN_2 || '', name: 'Tin 2' },
  { minElo: 720, roleId: process.env.ELO_ROLE_TIN_1 || '', name: 'Tin 1' },
  { minElo: 200, roleId: process.env.ELO_ROLE_TIN_0 || '', name: 'Tin 0' },
];

const ALL_ELO_ROLE_IDS = ELO_ROLES.map((r) => r.roleId).filter(Boolean);

/**
 * Create and login a Discord client with intents needed to manage members/roles.
 */
export function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  return client;
}

/**
 * Sync one member's guild rank roles:
 * - If member already has the correct role (from DB), skip (don't remove or re-add).
 * - If not: remove any other guild role and add the correct one.
 * Returns { added, removed, unchanged } for debug reporting.
 */
export async function syncMemberRoles(member, dbRole, active) {
  const TGG_ROLE_ID = SYSTEM_ROLES.TGG;
  const VISITOR_ROLE_ID = SYSTEM_ROLES.VISITOR;
  const WAITING_LIST_ROLE_ID = SYSTEM_ROLES.WAITING_LIST;
  const PENDING_ROLE_ID = SYSTEM_ROLES.PENDING;

  const targetRoleId = ROLE_MAP[dbRole];
  const targetRoleName = ROLE_ID_TO_NAME[targetRoleId] ?? targetRoleId;

  const tag = member.user.tag;
  const id = member.id;

  if (active === false) {
    const rolesToRemove = [
      TGG_ROLE_ID,
      ...ALL_GUILD_ROLE_IDS,
    ];

    const removedNames = [];

    for (const roleId of rolesToRemove) {
      if (member.roles.cache.has(roleId)) {
        const name = ROLE_ID_TO_NAME[roleId] ?? roleId;
        removedNames.push(name);
        await member.roles.remove(roleId);
      }
    }

    if (removedNames.length) {
      console.log(`[REMOVE] ${tag} (${id}): removed ${removedNames.join(', ')}`);
    }

    if (!member.roles.cache.has(VISITOR_ROLE_ID)) {
      await member.roles.add(VISITOR_ROLE_ID);
      console.log(`[VISITOR] ${tag} (${id}): set as visitor`);
    }

    return { added: true, removed: removedNames, unchanged: false };
  }

  if (!targetRoleId) {
    console.warn(`[SKIP] Unknown role "${dbRole}" for ${tag} (${id})`);
    return { added: false, removed: [], unchanged: false };
  }

  if (member.roles.cache.has(VISITOR_ROLE_ID)) {
    await member.roles.remove(VISITOR_ROLE_ID);
    console.log(
      `[REMOVE] ${tag} (${id}): removed ${ROLE_ID_TO_NAME[VISITOR_ROLE_ID] ?? VISITOR_ROLE_ID}`
    );
  }

  if (member.roles.cache.has(WAITING_LIST_ROLE_ID)) {
    await member.roles.remove(WAITING_LIST_ROLE_ID);
    console.log(
      `[REMOVE] ${tag} (${id}): removed ${ROLE_ID_TO_NAME[WAITING_LIST_ROLE_ID] ?? WAITING_LIST_ROLE_ID}`
    );
  }
  
  if (member.roles.cache.has(PENDING_ROLE_ID)) {
    await member.roles.remove(PENDING_ROLE_ID);
    console.log(
      `[REMOVE] ${tag} (${id}): removed ${ROLE_ID_TO_NAME[PENDING_ROLE_ID] ?? PENDING_ROLE_ID}`
    );
  }

  if (!member.roles.cache.has(TGG_ROLE_ID)) {
    await member.roles.add(TGG_ROLE_ID);
    console.log(
      `[ADD] ${tag} (${id}): added ${ROLE_ID_TO_NAME[TGG_ROLE_ID] ?? TGG_ROLE_ID} (Active user)`
    );
  }

  if (member.roles.cache.has(targetRoleId)) {
    console.log(`[OK] ${tag} (${id}): already has ${targetRoleName}, skip`);
    return { added: false, removed: [], unchanged: true };
  }

  // Remove outros ranks
  const toRemove = member.roles.cache.filter((role) =>
    ALL_GUILD_ROLE_IDS.includes(role.id)
  );
  const removedNames = [];
  for (const [, role] of toRemove) {
    const name = ROLE_ID_TO_NAME[role.id] ?? role.id;
    removedNames.push(name);
    await member.roles.remove(role.id);
  }
  if (removedNames.length) {
    console.log(`[REMOVE] ${tag} (${id}): removed ${removedNames.join(', ')}`);
  }
  await member.roles.add(targetRoleId);
  console.log(`[ADD] ${tag} (${id}): added ${targetRoleName} (DB role: ${dbRole})`);
  return { added: true, removed: removedNames, unchanged: false };
}

// sincroniza todos os usuarios de um guild
export async function runSync(client, users) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild not found: ${guildId}`);
  }

  const synced = [];
  const skippedNoId = [];
  const skippedNotInGuild = [];
  const failed = [];

  console.log('\n--- Sync start ---');
  console.log(`Guild: ${guild.name} (${guild.id}), users from DB: ${users.length}\n`);

  for (const user of users) {
    if (user.discord_id == null || user.discord_id === '') {
      skippedNoId.push({ role: user.role });
      continue;
    }

    try {
      const member = await guild.members.fetch(user.discord_id).catch(() => null);
      if (!member) {
        console.warn(`[NOT IN GUILD] ${user.discord_id} (DB role: ${user.role})`);
        skippedNotInGuild.push({ discord_id: user.discord_id, role: user.role });
        continue;
      }
      await syncMemberRoles(member, user.role, user.active);
      synced.push({ discord_id: user.discord_id, role: user.role, tag: member.user.tag });
    } catch (err) {
      console.error(`[ERROR] ${user.discord_id}:`, err.message);
      failed.push({ discord_id: user.discord_id, role: user.role, error: err.message });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Synced (has correct role): ${synced.length}`);
  synced.forEach((u) => console.log(`  • ${u.tag} (${u.discord_id}) → ${u.role}`));
  console.log(`\nSkipped (no discord_id in DB): ${skippedNoId.length}`);
  console.log(`Skipped (not in guild): ${skippedNotInGuild.length}`);
  skippedNotInGuild.forEach((u) => console.log(`  • ${u.discord_id} (DB role: ${u.role})`));
  console.log(`\nErrors: ${failed.length}`);
  failed.forEach((u) => console.log(`  • ${u.discord_id}: ${u.error}`));
  console.log('--- Sync done ---\n');

  return {
    synced: synced.length,
    skipped: skippedNoId.length + skippedNotInGuild.length,
    errors: failed.length,
    syncedList: synced,
    skippedNoId,
    skippedNotInGuild,
    failed,
  };
}

// retorna tier de elo baseado na rating
function getEloRoleForRating(elo) {
  const rating = Number(elo) || 0;
  for (const tier of ELO_ROLES) {
    if (rating >= tier.minElo) return tier;
  }
  return null;
}

// sincroniza os elo roles do membro
export async function syncMemberEloRoles(member, elo) {
  const tier = getEloRoleForRating(elo);
  const tag = member.user.tag;
  const id = member.id;

  if (tier && tier.roleId && member.roles.cache.has(tier.roleId)) {
    const otherEloRoles = member.roles.cache.filter((r) => ALL_ELO_ROLE_IDS.includes(r.id) && r.id !== tier.roleId);
    if (otherEloRoles.size === 0) {
      console.log(`[ELO OK] ${tag} (${id}): already has ${tier.name}`);
      return { added: false, tier: tier.name };
    }
  }

  const toRemove = member.roles.cache.filter((r) => ALL_ELO_ROLE_IDS.includes(r.id));
  for (const [, role] of toRemove) {
    await member.roles.remove(role.id);
  }
  if (toRemove.size) {
    console.log(`[ELO REMOVE] ${tag} (${id}): removed ${toRemove.size} ELO role(s)`);
  }

  if (!tier) {
    console.log(`[ELO SKIP] ${tag} (${id}): elo ${elo} below minimum tier (200), no role added`);
    return { added: false };
  }
  if (!tier.roleId) {
    console.log(`[ELO SKIP] ${tag} (${id}): ${tier.name} has no roleId set (env), no role added`);
    return { added: false, tier: tier.name };
  }

  await member.roles.add(tier.roleId);
  console.log(`[ELO ADD] ${tag} (${id}): added ${tier.name} (elo ${elo})`);
  return { added: true, tier: tier.name };
}

// sincroniza elo de todos os usuarios
export async function runEloSync(client, usersWithElo) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const guild = await client.guilds.fetch(guildId);
  if (!guild) throw new Error(`Guild not found: ${guildId}`);

  const synced = [];
  const skippedNotInGuild = [];
  const failed = [];

  console.log('\n--- ELO Sync start ---');
  console.log(`Guild: ${guild.name}, users with ELO from DB: ${usersWithElo.length}\n`);

  for (const { discord_id, elo } of usersWithElo) {
    try {
      const member = await guild.members.fetch(discord_id).catch(() => null);
      if (!member) {
        console.warn(`[ELO NOT IN GUILD] ${discord_id} (elo: ${elo})`);
        skippedNotInGuild.push({ discord_id, elo });
        continue;
      }
      await syncMemberEloRoles(member, elo);
      synced.push({ discord_id, elo, tag: member.user.tag });
    } catch (err) {
      console.error(`[ELO ERROR] ${discord_id}:`, err.message);
      failed.push({ discord_id, elo, error: err.message });
    }
  }

  console.log('\n--- ELO Summary ---');
  console.log(`Synced: ${synced.length}`);
  synced.forEach((u) => console.log(`  • ${u.tag} (${u.discord_id}) → elo ${u.elo}`));
  console.log(`Skipped (not in guild): ${skippedNotInGuild.length}`);
  console.log(`Errors: ${failed.length}`);
  console.log('--- ELO Sync done ---\n');

  return { synced: synced.length, skipped: skippedNotInGuild.length, errors: failed.length, syncedList: synced, failed };
}
