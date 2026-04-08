import { getClient, formatDateTime } from './db.js';
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

/**
 * Pegar as missões semanais para a semana atual (usado para as conquistas)
 */
export async function getWeeklyMissions(weekStart, weekEnd) {
  const supabase = getClient();

  const now = new Date();
  const end = new Date(weekEnd);

  // Se já passou do fim da semana (Quarta-feira às 06:00), não retorna missões
  if (now > end) {
    return [];
  }

  const { data, error } = await supabase
    .from('elo_missions')
    .select('*')
    .eq('week_start', weekStart)
    .order('mode', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Verificar o progresso do usuário em uma missão específica (usado para as conquistas)
 */
export function checkMissionCompletion({type, initial_elo, initial_games, initial_wins, final_elo, final_games, final_wins, target_elo}) {
  const typeNormalized = type.toLowerCase();

  // Missões do tipo "elo"
  if (typeNormalized === 'elo') {

    // Se não tiver feito a md10
    if (initial_games < 10) {
      return {
        completed: final_games >= 10,
        tip: '💡 Termine a MD10'
      };
    }

    // Se tiver feito a md10 mas não tiver atingido o elo alvo, mostra a dica de ganhar partidas
    if (initial_elo < target_elo) {
      return {
        completed: final_elo >= target_elo,
        tip: `💡 Atinga ${target_elo} de elo`
      };
    }

    // Se tiver o elo, ganhar 1 partida
    return {
      completed: final_wins > initial_wins,
      tip: '💡 Vença 1 partida'
    };
  }

  // Missões do tipo "wins"
  if (typeNormalized === 'wins') {
    return {
      completed: (final_wins - initial_wins) >= target_elo,
      tip: `💡 Ganhe mais ${target_elo - (final_wins - initial_wins)} partidas`
    };
  }

  // Missões do tipo "games"
  if (typeNormalized === 'games') {
    return {
      completed: (final_games - initial_games) >= target_elo,
      tip: `💡 Jogue mais ${target_elo - (final_games - initial_games)} partidas`
    };
  }

  return { completed: false, tip: '' };
}

/**
 * Buscar o progresso salvo do usuário para as missões da semana (usado para as conquistas)
 */
export async function getPlayerMissionProgress(brawlhallaID, missionId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('player_elo_missions')
    .select('*')
    .eq('brawlhalla_id', brawlhallaID)
    .eq('mission_id', missionId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  return data;
}

/**
 * Extrair os dados dos modos das missões para fazer comparações (usado para as conquistas)
 */
export function extractModeData(stats, mode) {
  const ranked = stats.ranked;

  const normalized = mode.toLowerCase();

  // 1v1
  if (normalized.includes('1v1')) {
    return {
      elo: ranked.rating || 0,
      games: ranked.games || 0,
      wins: ranked.wins || 0
    };
  }

  // 2v2 (Pegar o maior rating e somar games e wins de todas as equipes)
  if (normalized.includes('2v2')) {
    const teams = ranked['2v2'] || [];

    let maxElo = 0;
    let totalGames = 0;
    let totalWins = 0;

    for (const team of teams) {
      if (team.rating > maxElo) {
        maxElo = team.rating;
      }

      totalGames += team.games || 0;
      totalWins += team.wins || 0;
    }

    return {
      elo: maxElo,
      games: totalGames,
      wins: totalWins
    };
  }

  // 3v3 (rotating_ranked)
  if (normalized.includes('3v3')) {
    const r = ranked.rotating_ranked || {};

    return {
      elo: r.rating || 0,
      games: r.games || 0,
      wins: r.wins || 0
    };
  }

  // fallback
  return { elo: 0, games: 0, wins: 0 };
}

/**
 * Normalizar o tipo dos modos (ranked 1v1 = 1v1, etc)
 */
export function getModeFields(mode) {
  let normalized = mode.toLowerCase();
  if (normalized === 'ranked 1v1')
    normalized = '1v1';
  if (normalized === 'ranked 2v2')
    normalized = '2v2';
  if (normalized === 'ranked 3v3')
    normalized = '3v3';

  return {
    elo: `initial_elo_${normalized}`,
    games: `initial_games_${normalized}`,
    wins: `initial_wins_${normalized}`
  };
}

/**
 * Verificar se o usuário já completou a missão (usado para as conquistas, para evitar que ele complete várias vezes a mesma missão) 
 */
export async function hasCompletedMission(discordId, missionId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_achievements')
    .select('*')
    .eq('discord_id', discordId)
    .eq('mission_id', missionId);

  if (error) {
    throw error;
  }

  const exists = data && data.length > 0;
  return exists;
}

/**
 * Usado quando o usuário completa alguma missão semanal, para registrar a conquista e pagar as moedas
 */
export async function completeMission(discordId, mission) {
  const supabase = getClient();

  const { error } = await supabase
    .from('tgg_coins_achievements')
    .insert({
      discord_id: discordId,
      mission_id: mission.id,
      coins_earned: mission.tgg_coins_reward
    });

  if (error) throw error;

  // Paga as moedas quando completa a missão
  await addTransaction(discordId, mission.tgg_coins_reward, 'MISSION', `Missão ${mission.mode} concluída`);
  await updateBalance(discordId, mission.tgg_coins_reward);
}

/**
 * Função para pegar as conquistas (missões semanais) de um usuário
 */
export async function getUserAchievements(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_achievements')
    .select(`mission_id, coins_earned, completed_at, elo_missions (mode, type, target_elo)`)
    .eq('discord_id', discordId)
    .order('completed_at', { ascending: false });
  if (error) throw error;

  return data;
}