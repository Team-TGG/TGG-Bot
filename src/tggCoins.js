import { getClient, formatDateTime } from './db.js';
import { TGG_COINS_ROLES } from './tggCoinsCommands.js';
import { tggCoinsEvents } from '../config/index.js';
import { SYSTEM_ROLES} from './discord.js';
import { fetchPlayerStats} from './brawlhalla.js';

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
 * Adicionar transação para os tickets
 */
export async function addTicketTransaction(discordId, eventId, amount, type, description ) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_event_transactions')
    .insert({
      discord_id: String(discordId),
      event_id: eventId,
      amount,
      type,
      description,
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
 * Atualiza saldo dos tickets
 */
export async function updateTicketBalance(discordId, amount) {
  const supabase = getClient();

  const { data: existing, error: fetchError } =
    await supabase
      .from('tgg_coins_event_wallet')
      .select('balance')
      .eq('discord_id', String(discordId))
      .maybeSingle();

  if (fetchError) throw fetchError;

  const newBalance =
    (existing?.balance || 0) + amount;

  const { error } =
    await supabase
      .from('tgg_coins_event_wallet')
      .upsert(
        {
          discord_id: String(discordId),
          balance: newBalance,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'discord_id'
        }
      );

  if (error) throw error;

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
 * Pega a streak (DE EVENTOS) do usuário
 */
export async function getEventUserStreak(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_event_daily_streak')
    .select('*')
    .eq('discord_id', String(discordId))
    .maybeSingle();

  if (error) throw error;

  return data;
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
 * Atualiza ou cria a streak do usuário (PARA EVENTOS)
 */
export async function upsertEventUserStreak(discordId, streak) {
  const supabase = getClient();

  const { error } = await supabase
    .from('tgg_coins_event_daily_streak')
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
 * Pega saldo dos tickets
 */
export async function getEventBalance(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_event_wallet')
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
 * Pega leaderboard total (ordenado pelo total de TGG_coins ganho)
 */
export async function getTotalCoinsLeaderboard(page = 1, limit = 10) {
  const supabase = getClient();

  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('vw_tgg_coins_wallet_total')
    .select('*', { count: 'exact' })
    .order('balance', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  return {
    data: data || [],
    total: count || 0
  };
}

/**
 * Pega leaderboard dos eventos (ordenado por Tickets)
 */
export async function getEventLeaderboard(page = 1, limit = 10) {
  const supabase = getClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await supabase
    .from('tgg_coins_event_wallet')
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
 * Função para pegar um código disponível do Exitlag (usado para o item de Exitlag)
 */
export async function getAvailableExitlagCode() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_shop_exitlag')
    .select('*')
    .is('used_at', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('id', { ascending: true })
    .limit(1);

  if (error) throw error;

  return data.length ? data[0] : null;
}

/**
 * Função para marcar o código como usado e quem usou (usado para o item de Exitlag)
 */
export async function markExitlagCodeAsUsed(id, discordId) {
  const supabase = getClient();

  const { error } = await supabase
    .from('tgg_coins_shop_exitlag')
    .update({
      discord_id: String(discordId),
      used_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
}


/**
 * Função para calcular o preço com desconto (usado para boosters)
 */
export function getDiscountedPrice(member, item) {
  let price = item.price;

  if (item.type === 'EVENT' || item.type === 'EVENT_ROLE') {
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
 * Retorna os itens da loja de um determinado tipo
 */
export async function getShopItemsByType(type) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_shop')
    .select('role_id')
    .eq('type', type)
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
  if (now >= end) {
    return [];
  }

  const { data, error } = await supabase
    .from('tgg_coins_achievements')
    .select('*')
    .gte('week_start', weekStart)
    .lt('week_start', weekEnd)
    .order('mode', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Pegar todas as contas associadas a um main_id (usado para as conquistas, para verificar o progresso mesmo que o usuário tenha alt)
 */
export async function getAllAccounts(mainId) {
  const supabase = getClient();

  mainId = String(mainId);

  // Verifica se essa conta é uma alt de outra conta e envia também o dado dela
  const { data: mainData, error: mainError } = await supabase
    .from('tgg_coins_achievements_alts')
    .select('main_id')
    .eq('alt_id', mainId)
    .maybeSingle();

  if (mainError) throw mainError;

  // Se encontrou uma main, substitui
  if (mainData?.main_id) {
    mainId = String(mainData.main_id);
  }

  // Buscar todas as alts dessa main
  const { data, error } = await supabase
    .from('tgg_coins_achievements_alts')
    .select('alt_id')
    .eq('main_id', mainId);

  if (error) throw error;

  const altIds = data?.map(a => String(a.alt_id)) || [];

  return [...new Set([
    String(mainId),
    ...altIds
  ])];
}

/**
 * Verificar o progresso do usuário em uma missão específica (usado para as conquistas)
 */
export function checkMissionCompletion({type, initial_elo, initial_games, initial_wins, final_elo, final_games, final_wins, target}) {
  const typeNormalized = type.toLowerCase();

  // Missões do tipo "elo"
  if (typeNormalized === 'elo') {

    // SEMPRE faz validação pelo target real e quantidade de vitórias
    const reachedElo = final_elo >= target;
    const wonMatch = final_wins > initial_wins;

    const completed = reachedElo && wonMatch;

    // Dica separada da lógica de conclusão
    let tip = '';

    if (final_games < 10) {
      tip = '💡 Termine a MD10'; // Se não tiver feito a md10
    } else if (final_elo < target) {
      tip = `💡 Atinga ${target} de elo`; // Se tiver feito a md10 mas não tiver atingido o elo alvo, mostra a dica de ganhar partidas
    } else {
      tip = '💡 Vença 1 partida'; // Se tiver o elo, ganhar 1 partida
    }

    return { completed, tip };
  }

  // Missões do tipo "wins"
  if (typeNormalized === 'wins') {
    const progress = final_wins - initial_wins;

    return {
      completed: progress >= target,
      tip: `💡 Ganhe mais ${Math.max(0, target - progress)} partidas`
    };
  }

  // Missões do tipo "games"
  if (typeNormalized === 'games') {
    const progress = final_games - initial_games;

    return {
      completed: progress >= target,
      tip: `💡 Jogue mais ${Math.max(0, target - progress)} partidas`
    };
  }

  return { completed: false, tip: '' };
}

/**
 * Buscar o progresso salvo do usuário para as missões da semana (usado para as conquistas)
 */
export async function getPlayerMissionProgress(brawlhallaID, week_start) {
  const supabase = getClient();

  let query = supabase
    .from('player_weekly_info')
    .select('*')
    .eq('week_start', week_start);

  // Se for array → usa IN
  if (Array.isArray(brawlhallaID)) {
    query = query.in('brawlhalla_id', brawlhallaID);
  } else {
    query = query.eq('brawlhalla_id', brawlhallaID);
  }

  const { data, error } = await query;

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
    .from('tgg_coins_achievements_finished')
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
    .from('tgg_coins_achievements_finished')
    .insert({
      discord_id: discordId,
      mission_id: mission.id,
      coins_earned: mission.reward
    });

  if (error) throw error;

  // Paga as moedas quando completa a missão
  await addTransaction(discordId, mission.reward, 'MISSION', `Missão ${mission.mode} concluída`);
  await updateBalance(discordId, mission.reward);

  // Se houver evento ativo, paga tickets também
  const activeEvent = await getActiveEvent();

  if (activeEvent) {
    await addTicketTransaction(discordId, activeEvent.id, mission.reward, 'MISSION', `Tickets por missão ${mission.mode}`);
    await updateTicketBalance(discordId, mission.reward);
  }
}

/**
 * Adicionar conta alt para o usuário, usado para as conquistas semanais, para que ele possa progredir mesmo que jogue em outra conta.
 */
export async function addAltAccount({ mainId, altId }) {
  const supabase = getClient();

  mainId = String(mainId);
  altId = String(altId);

  if (mainId === altId) {
    return { success: false, error: 'SELF' };
  }

  // Verificar se o alt já está vinculado a esse main
  const { data: existing } = await supabase
    .from('tgg_coins_achievements_alts')
    .select('id')
    .eq('main_id', mainId)
    .eq('alt_id', altId)
    .maybeSingle();

  if (existing) {
    return { success: false, error: 'ALREADY_OWNED' };
  }

  // Verificar se o alt já está vinculado a outro main
  const { data: alreadyLinked } = await supabase
    .from('tgg_coins_achievements_alts')
    .select('id')
    .eq('alt_id', altId)
    .maybeSingle();

  if (alreadyLinked) {
    return { success: false, error: 'ALREADY_LINKED' };
  }

  // Ver se a conta existe e é válida
  let stats;
  try {
    stats = await fetchPlayerStats(altId);

    if (!stats || !stats.name) {
      return { success: false, error: 'INVALID' };
    }
  } catch {
    return { success: false, error: 'INVALID' };
  }

  // Vincular alt ao main
  const { error } = await supabase
    .from('tgg_coins_achievements_alts')
    .insert({
      main_id: mainId,
      alt_id: altId
    });

  if (error) {
    return { success: false, error: 'DB_ERROR', message: error.message };
  }

  return { success: true, name: stats.name, altId };
}

/**
 * Função para pegar as conquistas (missões semanais) de um usuário
 */
export async function getUserAchievements(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('tgg_coins_achievements_finished')
    .select(`mission_id, coins_earned, completed_at, tgg_coins_achievements (mode, type, target)`)
    .eq('discord_id', discordId)
    .order('completed_at', { ascending: false });
  if (error) throw error;

  return data;
}

/**
 * Ver se tem algum evento ativo
 */
export async function getActiveEvent() {
  const supabase = getClient();

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('tgg_coins_events')
    .select('*')
    .is('finished_at', null)
    .lte('started_at', now)
    .order('started_at', {ascending: false})
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

/**
 * Verifica se o evento acabou e encerra automaticamente
 */
export async function checkAndFinishEvent(guild) {
  const supabase = getClient();

  const activeEvent = await getActiveEvent();

  if (!activeEvent) return false;

  // Se existir qualquer item com estoque > 0, evento continua
  const { data: remainingItems, error } = await supabase
    .from('tgg_coins_shop')
    .select('id')
    .eq('type', 'EVENT')
    .gt('stock', 0)
    .limit(1);

  if (error) throw error;

  if (remainingItems?.length) {
    return false;
  }

  // Fecha só se ainda estiver aberto (evita rodar duas vezes)
  const { data: ended, error: finishError } =
    await supabase
      .from('tgg_coins_events')
      .update({finished_at: new Date().toISOString()})
      .eq('id', activeEvent.id)
      .is('finished_at', null)
      .select();

  if (finishError) throw finishError;

  if (!ended?.length) {
    return false;
  }

  // Zera tickets
  const { error: walletError } =
    await supabase
      .from('tgg_coins_event_wallet')
      .update({
        balance: 0,
        updated_at: new Date().toISOString()
      })
      .gt('balance', 0);

  if (walletError) throw walletError;

  // Zera streaks
  const { error: streakError } =
    await supabase
      .from('tgg_coins_event_daily_streak')
      .update({
        streak: 0,
        last_daily: null
      })
      .gt('streak', 0);

  if (streakError) throw streakError;

  const channel = await guild.channels.fetch(
    tggCoinsEvents.anunciosChannelId
  );

  if (channel) {
    await channel.send({
      content:
        `<@&${SYSTEM_ROLES.TGG}>\n🎉 O evento acabou!\nTodos os itens foram adquiridos.`
    });
  }

  return true;
}

/**
 *  Verifica se já completou o quiz
 */
export async function hasCompletedQuiz(discordId) {
  const supabase = getClient();

  const { data } = await supabase
    .from('tgg_quiz_completed')
    .select('*')
    .eq('discord_id', discordId)
    .single();

  return !!data;
}

/*
 *  Marca quiz como completo
*/
export async function markQuizCompleted(discordId) {
  const supabase = getClient();
  
  return supabase
    .from('tgg_quiz_completed')
    .insert({
      discord_id: discordId,
      completed_at: new Date()
    });
}