import { getClient } from './db.js';
import { TGG_COINS_ROLES } from './tggCoinsCommands.js';

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
 * Pega a streak do usuário
 */
export async function getUserStreak(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_daily_streak')
    .select('*')
    .eq('discord_id', String(discordId))
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  return data || null;
}

/**
 * Atualiza ou cria a streak do usuário (usado no daily)
 */
export async function upsertUserStreak(discordId, streak) {
  const supabase = getClient();

  const { error } = await supabase
    .from('tgg_coins_daily_streak')
    .upsert({
      discord_id: String(discordId),
      streak,
      last_daily: new Date().toISOString()
    });

  if (error) throw error;
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
export async function getShopItemByPosition(position, category = 'GERAL') {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_shop')
    .select('*')
    .eq('active', true)
    .order('price', { ascending: true });

  if (error) throw error;

  const filtered = data.filter(item => getCategory(item.type) === category);

  return filtered[position - 1] || null;
}

// Função para pegar a categoria do item com base no tipo
export function getCategory(type) {
  if (type.startsWith('ROLE')) return 'CARGOS';
  if (type === 'SERVICE') return 'SERVICOS';
  return 'GERAL';
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

/**
  * Pega os provedores de serviço ativos para um item específico
 */
export async function getServiceProviders(shopId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_service_providers')
    .select('discord_id')
    .eq('shop_id', shopId)
    .eq('active', true);

  if (error) throw error;

  return data;
}

/**
  * Adiciona um provedor de serviço para um item específico
 */
export async function addServiceProvider(shopId, discordId) {
  const supabase = getClient();

  const { error } = await supabase
    .from('tgg_coins_service_providers')
    .insert({
      shop_id: shopId,
      discord_id: String(discordId),
      active: true
    });

  if (error) throw error;
}

/**
  * Remove um provedor de serviço para um item específico
 */
export async function removeServiceProvider(shopId, discordId) {
  const supabase = getClient();

  const { error } = await supabase
    .from('tgg_coins_service_providers')
    .delete()
    .eq('shop_id', shopId)
    .eq('discord_id', String(discordId));

  if (error) throw error;
}

/**
  * Verifica se um usuário já é um provedor de serviço para um item específico (evitar duplicatas)
 */
export async function isServiceProvider(shopId, discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_service_providers')
    .select('id')
    .eq('shop_id', shopId)
    .eq('discord_id', String(discordId))
    .limit(1);

  if (error) throw error;

  return data.length > 0;
}

/**
 * Função para verificar se o usuário pode usar o mesmo item (limite de 1 por hora)
 */
export async function canUseItem(discordId, itemId) {
  const supabase = getClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('tgg_coins_purchases')
    .select('id, created_at')
    .eq('discord_id', String(discordId))
    .eq('shop_id', itemId)
    .gte('created_at', oneHourAgo)
    .limit(1);

  if (error) throw error;

  return data.length === 0;
}

/**
 * Função para calcular o preço com desconto (usado para boosters)
 */
export function getDiscountedPrice(member, item) {
  let price = item.price;

  if (item.type === 'EVENT'){
    return item.price; // Sem desconto para itens de eventos
  }

  // Booster pegam cores de graça
  if (member.roles.cache.has(TGG_COINS_ROLES.BOOSTER) && (item.type === 'ROLE_REGULAR' || item.type === 'ROLE_VIP') ) {
    return 0;
  }

  // Desconto padrão de booster
  if (member.roles.cache.has(TGG_COINS_ROLES.BOOSTER)) {
    const discount = 0.05; // 5% de desconto
    price = Math.floor(price * (1 - discount));
  }

  return price;
}

/**
 * Pegar as cores de cargo disponíveis para compra
 */
export async function getShopRolesByShopId(shopId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_shop_roles')
    .select('id, shop_id, name, role_id, created_at')
    .eq('shop_id', shopId)
    .order('name', { ascending: true });

  if (error) throw error;

  return data || [];
}