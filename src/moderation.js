import { getClient } from './db.js';

function isMissingExpiresAtColumn(error) {
  return error?.code === '42703'
    || error?.code === 'PGRST204'
    || error?.message?.includes('expires_at');
}

// Adiciona aviso no banco de dados
export async function addWarning(userId, moderatorId, reason, expiresAt = null) {
  const client = getClient();
  
  try {
    await deleteExpiredWarnings(userId);

    // Busca avisos existentes do usuário
    const { data: existingWarnings, error: fetchError } = await client
      .from('warnings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (fetchError) throw fetchError;
    
    const warningCount = (existingWarnings?.length || 0) + 1;
    
    // Insere novo aviso
    const payload = {
      user_id: userId,
      moderator_id: moderatorId,
      reason: reason,
      warning_number: warningCount
    };

    if (expiresAt) {
      payload.expires_at = expiresAt;
    }

    const { data, error } = await client
      .from('warnings')
      .insert(payload)
      .select()
      .single();
    
    if (error) throw error;
    
    return { warningCount, warning: data };
  } catch (error) {
    console.error('Error adding warning:', error);
    throw error;
  }
}

// Conta avisos do usuário
export async function getWarningCount(userId) {
  const client = getClient();
  
  try {
    await deleteExpiredWarnings(userId);

    const { count, error } = await client
      .from('warnings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (error) throw error;
    
    return count || 0;
  } catch (error) {
    console.error('Error getting warning count:', error);
    return 0;
  }
}

// Busca todos os avisos de um usuário
export async function getUserWarnings(userId) {
  const client = getClient();
  
  try {
    await deleteExpiredWarnings(userId);

    const { data, error } = await client
      .from('warnings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error getting user warnings:', error);
    return [];
  }
}

// Remove todos os avisos de um usuário
export async function clearWarnings(userId) {
  const client = getClient();
  
  try {
    const { error } = await client
      .from('warnings')
      .delete()
      .eq('user_id', userId);
    
    if (error) throw error;
    
    return true;
  } catch (error) {
    console.error('Error clearing warnings:', error);
    throw error;
  }
}

// Remove um aviso específico
export async function removeWarning(userId, warningNumber) {
  const client = getClient();
  
  try {
    await deleteExpiredWarnings(userId);

    const { error } = await client
      .from('warnings')
      .delete()
      .eq('user_id', userId)
      .eq('warning_number', warningNumber);
    
    if (error) throw error;
    
    // Reordena os números dos avisos restantes
    await reorderWarnings(userId);
    
    return true;
  } catch (error) {
    console.error('Error removing warning:', error);
    throw error;
  }
}

// Remove um aviso pelo ID do registro
export async function removeWarningById(warningId, userId) {
  const client = getClient();

  try {
    const { error } = await client
      .from('warnings')
      .delete()
      .eq('id', warningId);

    if (error) throw error;

    await reorderWarnings(userId);

    return true;
  } catch (error) {
    console.error('Error removing warning by id:', error);
    throw error;
  }
}

// Reordena os números dos avisos após remoção
async function reorderWarnings(userId) {
  const client = getClient();
  
  try {
    const { data: warnings, error } = await client
      .from('warnings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    // Atualiza números sequencialmente
    for (let i = 0; i < warnings.length; i++) {
      await client
        .from('warnings')
        .update({ warning_number: i + 1 })
        .eq('id', warnings[i].id);
    }
  } catch (error) {
    console.error('Error reordering warnings:', error);
  }
}

// Remove avisos temporários vencidos e reorganiza a numeração
export async function deleteExpiredWarnings(userId = null) {
  const client = getClient();
  const now = new Date().toISOString();

  try {
    let query = client
      .from('warnings')
      .delete()
      .lt('expires_at', now)
      .select('user_id');

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const affectedUsers = [...new Set((data || []).map(w => w.user_id))];

    for (const affectedUserId of affectedUsers) {
      await reorderWarnings(affectedUserId);
    }

    return data?.length || 0;
  } catch (error) {
    if (isMissingExpiresAtColumn(error)) return 0;
    console.error('Error deleting expired warnings:', error);
    throw error;
  }
}

// Busca avisos temporários ainda ativos para restaurar timers no boot
export async function getActiveTemporaryWarnings() {
  const client = getClient();
  const now = new Date().toISOString();

  try {
    await deleteExpiredWarnings();

    const { data, error } = await client
      .from('warnings')
      .select('*')
      .gt('expires_at', now);

    if (error) throw error;

    return data || [];
  } catch (error) {
    if (isMissingExpiresAtColumn(error)) return [];
    console.error('Error getting active temporary warnings:', error);
    throw error;
  }
}

// Remove o último aviso de um usuário
export async function removeLastWarning(userId) {
  const client = getClient();
  
  try {
    await deleteExpiredWarnings(userId);

    // Busca o aviso mais recente
    const { data: latestWarning, error: fetchError } = await client
      .from('warnings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (fetchError) {
      if (fetchError.code === 'PGRST116') return false; // Sem avisos
      throw fetchError;
    }
    
    if (!latestWarning) return false;
    
    // Remove o aviso
    const { error: deleteError } = await client
      .from('warnings')
      .delete()
      .eq('id', latestWarning.id);
    
    if (deleteError) throw deleteError;
    
    // Reordena os números dos avisos restantes
    await reorderWarnings(userId);
    
    return latestWarning.warning_number;
  } catch (error) {
    console.error('Error removing last warning:', error);
    throw error;
  }
}

// Edita o motivo de um aviso específico
export async function editWarning(userId, warningNumber, newReason) {
  const client = getClient();

  try {
    const { data, error } = await client
      .from('warnings')
      .update({ reason: newReason })
      .eq('user_id', userId)
      .eq('warning_number', warningNumber)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error editing warning:', error);
    throw error;
  }
}

// converte string de tempo (1s, 1m, 1h, 1d, 1M, 1y)
export function parseTime(timeString) {
  const match = timeString.match(/^(\d+)([smhdMy])$/);
  if (!match) return null;
  
  const [, amount, unit] = match;
  const num = parseInt(amount);
  
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    case 'M': return num * 30 * 24 * 60 * 60 * 1000;
    case 'y': return num * 365 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// formata duracao para exibição
export function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) return `${years} ano(s)`;
  if (months > 0) return `${months} mês(es)`;
  if (days > 0) return `${days} dia(s)`;
  if (hours > 0) return `${hours} hora(s)`;
  if (minutes > 0) return `${minutes} minuto(s)`;
  return `${seconds} segundo(s)`;
}

// Máximo delay do setTimeout (2^31 - 1 ms, aprox 24.8 dias)
const MAX_TIMEOUT = 2147483647;

/**
 * setTimeout robusto que suporta atrasos maiores que 24.8 dias.
 * @param {Function} callback 
 * @param {number} delay 
 */
export function safeSetTimeout(callback, delay) {
  if (delay <= MAX_TIMEOUT) {
    return setTimeout(callback, delay);
  }

  // Se o delay for maior que o máximo, agendamos o máximo e repetimos recursivamente
  return setTimeout(() => {
    safeSetTimeout(callback, delay - MAX_TIMEOUT);
  }, MAX_TIMEOUT);
}
