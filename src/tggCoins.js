import { getClient } from './db.js';

/**
 * Adiciona transação
 */
export async function addTransaction(discordId, amount, type, description) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_transactions')
    .insert({
      discord_id: String(discordId),
      amount: amount,
      type: type,
      description: description,
      created_at: new Date().toISOString()
    })
    .select();

  if (error) throw error;
  return data?.[0] || null;
}


/**
 * Atualiza saldo do usuário
 */
export async function updateBalance(discordId, amount) {
  const supabase = getClient();

  const { data: user, error: fetchError } = await supabase
    .from('tgg_coins_wallet')
    .select('balance')
    .eq('discord_id', String(discordId))
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

  // Se não existir, cria a carteira
  if (!user) {
    const { error: insertError } = await supabase
      .from('tgg_coins_wallet')
      .insert({
        discord_id: String(discordId),
        balance: amount,
        created_at: new Date().toISOString()
      });

    if (insertError) throw insertError;

    return amount;
  }

  const newBalance = (user.balance || 0) + amount;

  const { error: updateError } = await supabase
    .from('tgg_coins_wallet')
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq('discord_id', String(discordId));

  if (updateError) throw updateError;

  return newBalance;
}


/**
 * Pega o horário do último daily
 */
export async function getLastDaily(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_transactions')
    .select('created_at')
    .eq('discord_id', String(discordId))
    .eq('type', 'DAILY')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  return data?.[0] || null;
}


/**
 * Pega saldo atual
 */
export async function getBalance(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_wallet')
    .select('balance')
    .eq('discord_id', String(discordId))
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  return data?.balance || 0;
}


/**
 * Pega transações do usuário
 */
export async function getTransactions(discordId, page = 1, limit = 10) {
  const supabase = getClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await supabase
    .from('tgg_coins_transactions')
    .select('*', { count: 'exact' })
    .eq('discord_id', String(discordId))
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;

  return {
    data: data ?? [],
    total: count ?? 0
  };
}

/**
 * Pega leaderboard (ordenado por TGG_coins)
 */
export async function getLeaderboard(page = 1, limit = 10) {
  const supabase = getClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await supabase
    .from('tgg_coins_wallet')
    .select('discord_id, balance', { count: 'exact' })
    .order('balance', { ascending: false })
    .range(from, to);

  if (error) throw error;

  return {
    data: data ?? [],
    total: count ?? 0
  };
}

/**
 * Pega os itens ativos da loja
 */
export async function getShopItems(page = 1, limit = 1) {
  const supabase = getClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await supabase
    .from('tgg_coins_shop')
    .select('*', { count: 'exact' })
    .eq('active', true)
    .order('price', { ascending: true })
    .range(from, to);

  if (error) throw error;

  return {
    data: data ?? [],
    total: count ?? 0
  };
}

/**
 * Pega a contagem total de itens ativos na loja
 */
export async function getShopCount() {
  const supabase = getClient();

  const { count, error } = await supabase
    .from('tgg_coins_shop')
    .select('*', { count: 'exact', head: true })
    .eq('active', true);

  if (error) throw error;

  return count || 0;
}

/**
 * Pega um item específico da loja pela posição (Usado para o ".buy")
 */
export async function getShopItemByPosition(position) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_shop')
    .select('*')
    .eq('active', true)
    .order('price', { ascending: true });

  if (error) throw error;

  return data?.[position - 1] || null;
}

/**
 * Verifica se o usuário já comprou um item específico (usado para itens únicos)
 */
export async function hasPurchased(discordId, shopId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_purchases')
    .select('id')
    .eq('discord_id', String(discordId))
    .eq('shop_id', shopId)
    .limit(1);

  if (error) throw error;

  return data.length > 0;
}

/**
 * Função para compra do usuário
 */
export async function createPurchase(discordId, item) {
  const supabase = getClient();

  let expiresAt = null;

  if (item.type === 'TEMP_ROLE' && item.duration_hours) {
    const date = new Date();
    date.setHours(date.getHours() + item.duration_hours);
    expiresAt = date.toISOString();
  }

  const { error } = await supabase
    .from('tgg_coins_purchases')
    .insert({
      discord_id: String(discordId),
      shop_id: item.id,
      created_at: new Date().toISOString(),
      expires_at: expiresAt
    });

  if (error) throw error;
}

/**
 * Função para diminuir o estoque do item comprado
 */
export async function decreaseStock(itemId, currentStock) {
  if (currentStock === null) return;

  const supabase = getClient();

  const { error } = await supabase
    .from('tgg_coins_shop')
    .update({ stock: currentStock - 1 })
    .eq('id', itemId);

  if (error) throw error;
}