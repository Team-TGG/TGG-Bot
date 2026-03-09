// camada de banco: usuarios da tabela users (discord_id, role)

import { createClient } from '@supabase/supabase-js';
import { supabase as supabaseConfig } from '../config/index.js';

let client = null;

// inicia supabase client preguicosamente
function getClient() {
  if (!client) {
    if (!supabaseConfig.url) throw new Error('SUPABASE_URL is not set in .env');
    const key = supabaseConfig.serviceRoleKey || supabaseConfig.anonKey;
    if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY in .env');
    client = createClient(supabaseConfig.url, key);
  }
  return client;
}

// calcula quarta-feira anterior como referencia
function getLastWednesdayReference() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  let diff = (dayOfWeek - 3 + 7) % 7;

  if (diff === 0) {
    today.setDate(today.getDate() - 7);
  } else {
    today.setDate(today.getDate() - diff);
    today.setDate(today.getDate() - 7);
  }

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Get the week reference for the previous Thursday
 * Used to track missions from this week's Thursday
 */
function getMissionWeekStart() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = (dayOfWeek - 4 + 7) % 7;

  today.setDate(today.getDate() - diff);

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// busca todos os usuarios
export async function getUsers() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, role, active');
  if (error) throw error;
  return data ?? [];
}

// busca discord_id com maior pico de elo 1v1, 2v2 ou 3v3
export async function getUsersWithElo() {
  const supabase = getClient();

  const { data: history, error: historyError } = await supabase
    .from('player_elo_history')
    .select('brawlhalla_id, peak_1v1, peak_2v2, peak_3v3');
  if (historyError) throw historyError;

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id');
  if (usersError) throw usersError;

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

// busca usuario por discord id
export async function getUserByDiscordId(discord_id) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id, role, active')
    .eq('discord_id', discord_id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// marca jogador como inativo(quarta-feira anterior)
export async function addInactivePlayer(discord_id) {
  const supabase = getClient();
  
  const user = await getUserByDiscordId(discord_id);
  if (!user) throw new Error(`Usuário com Discord ID ${discord_id} não encontrado`);
  
  const brawlhalla_id = user.brawlhalla_id;
  const weekReference = getLastWednesdayReference();
  const today = new Date().toISOString().split('T')[0];
  
  const { data: existing, error: checkError } = await supabase
    .from('weekly_inactive_players')
    .select('id')
    .eq('brawlhalla_id', brawlhalla_id)
    .eq('week_reference', weekReference)
    .single();
  
  if (existing) {
    throw new Error(`Usuário já está marcado como inativo nesta semana`);
  }
  
  const { data, error } = await supabase
    .from('weekly_inactive_players')
    .insert({
      brawlhalla_id: String(brawlhalla_id),
      week_reference: weekReference,
      created_at: today,
      note: null,
    })
    .select();
  
  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Mark a user as active (remove from Wednesday's inactive list)
 * Instead of deleting, mark with /active command in the note field
 * @param {string} discord_id - The Discord user ID
 * @returns {Promise<number>} Number of records updated
 */
export async function removeInactivePlayer(discord_id, noteText = '') {
  const supabase = getClient();
  
  const user = await getUserByDiscordId(discord_id);
  if (!user) throw new Error(`Usuário com Discord ID ${discord_id} não encontrado`);
  
  const brawlhalla_id = user.brawlhalla_id;
  const weekReference = getLastWednesdayReference();

  const finalNote = noteText && noteText.length > 0
    ? noteText
    : 'usou o comando /active';

  const { data: existing, error: checkError } = await supabase
    .from('weekly_inactive_players')
    .select('id, note')
    .eq('brawlhalla_id', brawlhalla_id)
    .eq('week_reference', weekReference)
    .single();

  if (checkError && checkError.code !== 'PGRST116') throw checkError;

  if (!existing) {
    throw new Error('Usuário não está marcado como inativo nesta semana.');
  }

  if (existing.note !== null) {
    throw new Error('Usuário já está ativo.');
  }

  const { data, error } = await supabase
    .from('weekly_inactive_players')
    .update({ note: finalNote })
    .eq('id', existing.id);

  if (error) throw error;
  return data?.length || 0;
}

// busca inativos da quarta-feira anterior com discord id
export async function getInactivePlayers() {
  const supabase = getClient();
  const weekReference = getLastWednesdayReference(); // Only fetch last Wednesday data
  
  const { data: inactivePlayers, error: inactiveError } = await supabase
    .from('weekly_inactive_players')
    .select('brawlhalla_id, created_at, note')
    .eq('week_reference', weekReference)
    .is('note', null); // Only return those who haven't used /active (note is null)
  
  if (inactiveError) throw inactiveError;
  
  if (!inactivePlayers || inactivePlayers.length === 0) {
    return [];
  }
  
  const brawlhallaIds = inactivePlayers.map(p => String(p.brawlhalla_id));
  
  // Get Discord IDs for these Brawlhalla IDs
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id')
    .in('brawlhalla_id', brawlhallaIds);
  
  if (usersError) throw usersError;
  
  // Merge created_at from inactivePlayers
  const result = (users ?? []).map(user => {
    const inactiveRecord = inactivePlayers.find(p => String(p.brawlhalla_id) === String(user.brawlhalla_id));
    return {
      ...user,
      created_at: inactiveRecord?.created_at || new Date().toISOString(),
    };
  });
  
  return result;
}

// desativa usuario por discord id ou brawlhalla id
export async function deactivateUser(identifier) {
  const supabase = getClient();
  
  let query;
  if (identifier.startsWith('@')) {
    const discordId = identifier.slice(1);
    query = supabase.from('users').update({ active: false }).eq('discord_id', discordId);
  } else {
    query = supabase.from('users').update({ active: false }).eq('brawlhalla_id', identifier);
  }
  
  const { data, error } = await query.select();
  
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`Usuário não encontrado com ${identifier.startsWith('@') ? 'Discord ID' : 'Brawlhalla ID'}: ${identifier}`);
  }
  
  return data[0];
}

/**
 * Delete a user from the database by Discord ID or Brawlhalla ID
 * @param {string} identifier - Discord ID (with @) or Brawlhalla ID (numbers only)
 * @returns {Promise<Object>} The deleted record
 */
export async function deleteUser(identifier) {
  const supabase = getClient();
  
  let query;
  if (identifier.startsWith('@')) {
    const discordId = identifier.slice(1);
    query = supabase.from('users').delete().eq('discord_id', discordId);
  } else {
    query = supabase.from('users').delete().eq('brawlhalla_id', identifier);
  }
  
  const { data, error } = await query.select();
  
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`Usuário não encontrado com ${identifier.startsWith('@') ? 'Discord ID' : 'Brawlhalla ID'}: ${identifier}`);
  }
  
  return data[0];
}

export async function reactivateOrAddUser(discord_id, brawlhalla_id, username) {
  const supabase = getClient();
  
  // Check if user already exists (including inactive ones)
  const { data: existing, error: checkError } = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', discord_id)
    .single();
  
  if (checkError && checkError.code !== 'PGRST116') throw checkError; // PGRST116 = not found
  
  if (existing) {
    // User exists, reactivate them
    const { data, error } = await supabase
      .from('users')
      .update({ 
        active: true,
        username: username,
        brawlhalla_id: String(brawlhalla_id),
        role: 'recruit'
      })
      .eq('discord_id', discord_id)
      .select();
    
    if (error) throw error;
    return { ...data[0], reactivated: true };
  } else {
    // User doesn't exist, create new one
    const { data, error } = await supabase
      .from('users')
      .insert({
        discord_id: String(discord_id),
        brawlhalla_id: String(brawlhalla_id),
        username: username,
        role: 'recruit',
        active: true,
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
      })
      .select();
    
    if (error) throw error;
    return { ...data[0], reactivated: false };
  }
}

// add novo usuario com role recruit
export async function addUser(discord_id, brawlhalla_id, username) {
  const supabase = getClient();
  
  const { data: existing, error: checkError } = await supabase
    .from('users')
    .select('id')
    .eq('discord_id', discord_id)
    .single();
  
  if (existing) {
    throw new Error(`Usuário com Discord ID ${discord_id} já existe no banco de dados`);
  }
  
  const { data, error } = await supabase
    .from('users')
    .insert({
      discord_id: String(discord_id),
      brawlhalla_id: String(brawlhalla_id),
      username: username,
      role: 'recruit',
      active: true,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    })
    .select();
  
  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Fetch weekly missions starting from the most recent Thursday
 * @returns {Promise<Array>} Array of missions
 */
export async function getWeeklyMissions() {
  const supabase = getClient();

  const weekStart = getMissionWeekStart();

  const { data, error } = await supabase
    .from('weekly_missions')
    .select('id, week_start, mission, tip, target')
    .eq('week_start', weekStart)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return data ?? [];
}