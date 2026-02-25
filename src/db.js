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
    .select('discord_id, role, active');
  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch discord_id + highest peak elo (1v1, 2v2 or 3v3) per user.
 * Uses player_elo_history and returns the highest peak among all modes.
 */
export async function getUsersWithElo() {
  const supabase = getClient();

  // Busca histórico de elo
  const { data: history, error: historyError } = await supabase
    .from('player_elo_history')
    .select('brawlhalla_id, peak_1v1, peak_2v2, peak_3v3');
  if (historyError) throw historyError;

  // Busca usuários
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id');
  if (usersError) throw usersError;

  // brawlhalla_id -> maior elo entre todos os peaks
  const eloByBrawlhalla = new Map();

  for (const row of history ?? []) {
    const id = row.brawlhalla_id;

    const peak1 = row.peak_1v1 != null ? Number(row.peak_1v1) : 0;
    const peak2 = row.peak_2v2 != null ? Number(row.peak_2v2) : 0;
    const peak3 = row.peak_3v3 != null ? Number(row.peak_3v3) : 0;

    const highestPeak = Math.max(peak1, peak2, peak3);

    const current = eloByBrawlhalla.get(id);
    eloByBrawlhalla.set(
      id,
      current == null ? highestPeak : Math.max(current, highestPeak)
    );
  }

  const result = [];

  for (const u of users ?? []) {
    if (!u.discord_id) continue;

    const elo = eloByBrawlhalla.get(u.brawlhalla_id);
    if (elo == null) continue;

    result.push({
      discord_id: u.discord_id,
      elo,
    });
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
