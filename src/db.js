/**
 * Database layer: fetch users from Supabase for autorole sync.
 * Expects a `users` table with discord_id (string) and role (string).
 */

import { createClient } from '@supabase/supabase-js';
import { supabase as supabaseConfig } from '../config/index.js';

let client = null;

/**
 * Get Supabase client (lazy init). Uses SUPABASE_URL + service role key.
 */
function getClient() {
  if (!client) {
    if (!supabaseConfig.url) throw new Error('SUPABASE_URL is not set in .env');
    const key = supabaseConfig.serviceRoleKey || supabaseConfig.anonKey;
    if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY in .env');
    client = createClient(supabaseConfig.url, key);
  }
  return client;
}

/**
 * Fetch all users from the users table.
 * Returns rows with at least: discord_id, role.
 * Caller should skip rows where discord_id is null.
 */
export async function getUsers() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, role');
  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch discord_id + ELO (initial_elo_1v1) for users that have player_elo_missions.
 * Joins users (brawlhalla_id, discord_id) with player_elo_missions; uses max(initial_elo_1v1) per user.
 */
export async function getUsersWithElo() {
  const supabase = getClient();
  const { data: missions, error: missionsError } = await supabase
    .from('player_elo_missions')
    .select('brawlhalla_id, initial_elo_1v1');
  if (missionsError) throw missionsError;

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id');
  if (usersError) throw usersError;

  // brawlhalla_id -> max elo
  const eloByBrawlhalla = new Map();
  for (const row of missions ?? []) {
    const id = row.brawlhalla_id;
    const elo = row.initial_elo_1v1 != null ? Number(row.initial_elo_1v1) : 0;
    const cur = eloByBrawlhalla.get(id);
    eloByBrawlhalla.set(id, cur == null ? elo : Math.max(cur, elo));
  }

  const result = [];
  for (const u of users ?? []) {
    if (u.discord_id == null || u.discord_id === '') continue;
    const elo = eloByBrawlhalla.get(u.brawlhalla_id);
    if (elo == null) continue;
    result.push({ discord_id: u.discord_id, elo });
  }
  return result;
}

/**
 * Fetch users by their Brawlhalla IDs
 * @param {Array<number>} brawlhallaIds - Array of brawlhalla_ids to look up
 * @returns {Promise<Map>} Map of brawlhalla_id -> {discord_id, brawlhalla_id}
 */
export async function getUsersByBrawlhallaIds(brawlhallaIds) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id')
    .in('brawlhalla_id', brawlhallaIds);
  if (error) throw error;
  
  // Return as Map for O(1) lookups
  const map = new Map();
  for (const row of data ?? []) {
    if (row.discord_id && row.brawlhalla_id) {
      map.set(row.brawlhalla_id, { discord_id: row.discord_id, brawlhalla_id: row.brawlhalla_id });
    }
  }
  return map;
}

/**
 * Get a single user by Discord ID
 * @param {string} discord_id - The Discord user ID
 * @returns {Promise<Object|null>} User object with discord_id and brawlhalla_id, or null if not found
 */
export async function getUserByDiscordId(discord_id) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id')
    .eq('discord_id', discord_id)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
  return data || null;
}
