

import { createClient } from '@supabase/supabase-js';
import { supabase as supabaseConfig } from '../config/index.js';

let client = null;


export function getClient() {
  if (!client) {
    if (!supabaseConfig.url) throw new Error('SUPABASE_URL is not set in .env');
    const key = supabaseConfig.serviceRoleKey || supabaseConfig.anonKey;
    if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY in .env');
    client = createClient(supabaseConfig.url, key);
  }
  return client;
}

export function formatDateBR(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
}

export function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getLastWednesdayReference() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  let diff = (dayOfWeek - 3 + 7) % 7;

  if (diff === 0) {
    // Se hoje é quarta, volta 7 dias
    today.setDate(today.getDate() - 7);
  } else {
    // Vai para a última quarta
    today.setDate(today.getDate() - diff);
    // Voltar mais 7 dias
    today.setDate(today.getDate() - 7);
  }

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}


export function getMissionWeekStart() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = (dayOfWeek - 4 + 7) % 7;

  today.setDate(today.getDate() - diff);

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function getMissionWeekEnd() {
  const now = new Date();

  const dayOfWeek = now.getDay();

  // Quarta-feira
  let diff = (3 - dayOfWeek + 7) % 7;

  // Se hoje já é quarta mas ainda não passou das 06:00
  if (diff === 0) {
    const quartaHoje = new Date(now);
    quartaHoje.setHours(6, 0, 0, 0);

    if (now >= quartaHoje) {
      diff = 7; // vai pra próxima quarta
    }
  }

  const nextWednesday = new Date(now);
  nextWednesday.setDate(now.getDate() + diff);
  nextWednesday.setHours(6, 0, 0, 0);

  const year = nextWednesday.getFullYear();
  const month = String(nextWednesday.getMonth() + 1).padStart(2, '0');
  const day = String(nextWednesday.getDate()).padStart(2, '0');
  const hours = String(nextWednesday.getHours()).padStart(2, '0');
  const minutes = String(nextWednesday.getMinutes()).padStart(2, '0');
  const seconds = String(nextWednesday.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}


export async function getUsers() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, role, active')
    .eq('need_update', true) // Pegar somente os usuários que precisam ser atualizados
  if (error) throw error;
  return data ?? [];
}

export async function getActiveUser(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', discordId)
    .eq('active', true)
    .single();

  if (error) throw error;
  return data;
}



let BRAWLHALLA_ALIASES = null;

async function loadAliases() {
  if (BRAWLHALLA_ALIASES !== null) return;

  const supabase = getClient();

  const { data, error } = await supabase
    .from('alt_ids')
    .select('alt_id, main_id');

  if (error) throw error;

  BRAWLHALLA_ALIASES = {};

  for (const row of data) {
    BRAWLHALLA_ALIASES[String(row.alt_id)] = String(row.main_id);
  }
}

function resolveBrawlhallaId(id) {
  return BRAWLHALLA_ALIASES[id] || id;
}

export async function getUsersWithElo() {
  await loadAliases();

  const supabase = getClient();

  const { data: history, error: historyError } = await supabase
    .from('player_elo_history')
    .select('brawlhalla_id, peak_1v1, peak_2v2, peak_3v3')
    .eq('need_update', true); // Pegar somente os usuários que precisam ser atualizados

  if (historyError) throw historyError;

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id')
    .eq('active', true);

  if (usersError) throw usersError;

  const eloByBrawlhalla = new Map();

  for (const row of history ?? []) {
    const id = resolveBrawlhallaId(row.brawlhalla_id);

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

    const resolvedId = resolveBrawlhallaId(u.brawlhalla_id);

    const elo = eloByBrawlhalla.get(resolvedId);
    if (elo == null) continue;

    result.push({
      discord_id: u.discord_id,
      brawlhalla_id: resolvedId,
      elo,
    });
  }

  return result;
}


export async function getUsersByBrawlhallaIds(brawlhallaIds) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id')
    .in('brawlhalla_id', brawlhallaIds);
  if (error) throw error;
  

  const map = new Map();
  for (const row of data ?? []) {
    if (row.discord_id && row.brawlhalla_id) {
      map.set(row.brawlhalla_id, { discord_id: row.discord_id, brawlhalla_id: row.brawlhalla_id });
    }
  }
  return map;
}


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

export async function addInactivePlayer(discord_id) {
  const supabase = getClient();
  
  const user = await getUserByDiscordId(discord_id);
  if (!user) throw new Error(`Usuário com Discord ID ${discord_id} não encontrado`);
  
  const brawlhalla_id = user.brawlhalla_id;
  const weekReference = getLastWednesdayReference();
  const today = new Date().toISOString().split('T')[0];
  
  // checa se o usuario está na tabela essa semana
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


export async function removeInactivePlayer(discord_id, noteText = '') {
  const supabase = getClient();
  
  const user = await getUserByDiscordId(discord_id);
  if (!user) throw new Error(`Usuário com Discord ID ${discord_id} não encontrado`);
  
  const brawlhalla_id = user.brawlhalla_id;
  const weekReference = getLastWednesdayReference();

  const finalNote = noteText && noteText.length > 0
    ? noteText
    : 'usou o comando /active';

  // Primeiro verifica se ainda está inativo (note = NULL)
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

  // Se estiver inativo, faz o update
  const { data, error } = await supabase
    .from('weekly_inactive_players')
    .update({ note: finalNote })
    .eq('id', existing.id);

  if (error) throw error;
  return data?.length || 0;
}


export async function getInactivePlayers() {
  const supabase = getClient();
  const weekReference = getLastWednesdayReference();
  
  const { data: inactivePlayers, error: inactiveError } = await supabase
    .from('weekly_inactive_players')
    .select('brawlhalla_id, created_at, note')
    .eq('week_reference', weekReference)
    .is('note', null);
  
  if (inactiveError) throw inactiveError;
  
  if (!inactivePlayers || inactivePlayers.length === 0) {
    return [];
  }
  
  const brawlhallaIds = inactivePlayers.map(p => String(p.brawlhalla_id));
  
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('discord_id, brawlhalla_id')
    .in('brawlhalla_id', brawlhallaIds);
  
  if (usersError) throw usersError;
  
  const result = (users ?? []).map(user => {
    const inactiveRecord = inactivePlayers.find(p => String(p.brawlhalla_id) === String(user.brawlhalla_id));
    return {
      ...user,
      created_at: inactiveRecord?.created_at || new Date().toISOString(),
    };
  });
  
  return result;
}


export async function getWeeklyMissions() {
  const supabase = getClient();

  const weekStart = getMissionWeekStart();

  const { data, error } = await supabase
    .from('weekly_missions')
    .select('id, week_start, mission, tip, target, status')
    .eq('week_start', weekStart)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return data ?? [];
}


export async function reactivateOrAddUser(discord_id, brawlhalla_id, username) {
  const supabase = getClient();
  
 
  const { data: existing, error: checkError } = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', String(discord_id))
    .single();
  
  if (checkError && checkError.code !== 'PGRST116') throw checkError;
  
  if (existing) {
    const { data, error } = await supabase
      .from('users')
      .update({ 
        active: true,
        username: username,
        brawlhalla_id: String(brawlhalla_id),
        role: 'recruit'
      })
      .eq('discord_id', String(discord_id))
      .select();
    
    if (error) throw error;
    if (!data || data.length === 0) throw new Error(`Falha ao atualizar usuário ${discord_id}`);

    return { ...data[0], reactivated: true };
  } else {
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
    if (!data || data.length === 0) throw new Error(`Falha ao inserir novo usuário ${discord_id}`);

    return { ...data[0], reactivated: false };
  }
}


export async function addPersistentMute(discord_id, expires_at) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('mutes')
    .upsert({
      user_id: String(discord_id),
      expires_at: expires_at,
    }, { onConflict: 'user_id' })
    .select();

  if (error) throw error;
  return data?.[0] || null;
}

export async function removePersistentMute(discord_id) {
  const supabase = getClient();
  const { error } = await supabase
    .from('mutes')
    .delete()
    .eq('user_id', String(discord_id));

  if (error) throw error;
}

export async function getActiveMutes() {
  const supabase = getClient();
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('mutes')
    .select('*')
    .gt('expires_at', now);

  if (error) throw error;
  return data ?? [];
}
