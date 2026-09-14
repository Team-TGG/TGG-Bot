// Acesso ao Supabase do domínio das insígnias do .profile: `profile_badges`, `profile_badge_tiers`,
// `weekly_mvp_history`, `player_activity`, e a leitura em lote das tabelas de outros domínios que
// as insígnias medem. A regra mora em services/insigniasLeitura.js e services/insigniasMotor.js —
// aqui é só leitura e escrita.
import { getClient } from './db.js';

/* O PostgREST corta todo select em 10.000 linhas sem erro nenhum (medido em 13/09/2026:
   tgg_coins_transactions tinha 10.265 e voltaram 10.000). Leitura de tabela inteira pagina, e
   paginar exige ordem estável, senão a mesma linha cai em duas páginas e outra em nenhuma. */
const PAGINA = 1000;
const LOTE_ESCRITA = 500;
async function lerTudo(montarConsulta) {
  const linhas = [];

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await montarConsulta().range(inicio, inicio + PAGINA - 1);
    if (error) throw error;

    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return linhas;
  }
}

/* Para as tabelas criadas pelo docs/sql/insignias.sql, que podem ainda não existir. Ausente vira
   null ("não sei"), não lista vazia: vazia zeraria o tier de quem já tinha. */
async function lerTudoSeExistir(montarConsulta) {
  try {
    return await lerTudo(montarConsulta);
  } catch (err) {
    if (err.code === 'PGRST205') return null;
    throw err;
  }
}

/** Todo vínculo alt → main, das duas tabelas que guardam isso. */
export async function getVinculosDeContas() {
  const supabase = getClient();

  const [alts, altsDeConquista] = await Promise.all([
    lerTudo(() => supabase.from('alt_ids').select('alt_id, main_id').order('id')),
    lerTudo(() => supabase.from('tgg_coins_achievements_alts').select('alt_id, main_id').order('id')),
  ]);

  return [...alts, ...altsDeConquista];
}

/**
 * Tudo que as insígnias leem do banco, numa passada. `discordIds` e `contas` restringem a leitura
 * a quem vai ser recalculado (o botão de sync); sem eles, lê a guilda inteira.
 *
 * `mvps` e `atividades` voltam null enquanto as tabelas não existirem.
 */
export async function getFontesInsignias({ discordIds = null, contas = null } = {}) {
  const supabase = getClient();

  const doMembro = (consulta, coluna = 'discord_id') => (discordIds ? consulta.in(coluna, discordIds) : consulta);
  const daConta = (consulta) => (contas ? consulta.in('brawlhalla_id', contas) : consulta);

  const [
    semanas, carteiras, streaks, conquistas, compras, loja, motds, warns,
    aniversarios, quizzes, inativacoes, primeiraInativacao, mvps, atividades, usosDoHelp,
    marcacoesTopson, lancamentos,
  ] = await Promise.all([
    lerTudo(() => daConta(supabase.from('player_weekly_info')
      .select('brawlhalla_id, week_start, guild_points, initial_wins_1v1, initial_wins_2v2, initial_wins_3v3')).order('id')),
    // Apesar do nome, não é o saldo: a view soma toda entrada de moeda sem descontar gasto (14/09/2026).
    lerTudo(() => doMembro(supabase.from('vw_tgg_coins_wallet_total').select('discord_id, balance')).order('discord_id')),
    lerTudo(() => doMembro(supabase.from('tgg_coins_daily_streak').select('discord_id, streak')).order('discord_id')),
    lerTudo(() => doMembro(supabase.from('tgg_coins_achievements_finished').select('discord_id')).order('id')),
    lerTudo(() => doMembro(supabase.from('tgg_coins_purchases').select('discord_id, shop_id')).order('id')),
    lerTudo(() => supabase.from('tgg_coins_shop').select('id, type').order('id')),
    lerTudo(() => doMembro(supabase.from('motd').select('discord_id')).order('id')),
    lerTudo(() => doMembro(supabase.from('warnings').select('user_id, expires_at'), 'user_id').order('id')),
    // user_id é int8: sem o ::text o snowflake volta como Number e perde os últimos dígitos
    // (1447168951963353209 vira ...353000). É o mesmo cast de getTodayBirthdays.
    lerTudo(() => doMembro(supabase.from('birthdays').select('user_id::text'), 'user_id').order('id')),
    lerTudo(() => doMembro(supabase.from('tgg_quiz_completed').select('discord_id')).order('id')),
    lerTudo(() => daConta(supabase.from('weekly_inactive_players').select('brawlhalla_id, week_reference')).order('id')),
    supabase.from('weekly_inactive_players').select('week_reference').order('week_reference').limit(1),
    // Sem filtro de membro de propósito: a streak precisa saber quais semanas existem na tabela.
    lerTudoSeExistir(() => supabase.from('weekly_mvp_history').select('week_start, discord_id')
      .order('week_start').order('discord_id')),
    lerTudoSeExistir(() => doMembro(supabase.from('player_activity').select('*')).order('discord_id')),
    lerTudoSeExistir(() => doMembro(supabase.from('help_usage').select('discord_id')).order('discord_id')),
    lerTudoSeExistir(() => doMembro(supabase.from('topson_mentions').select('discord_id, dia'))
      .order('discord_id').order('dia')),
    lerTudoSeExistir(() => supabase.from('profile_badge_launches').select('badge_key, dia').order('badge_key')),
  ]);

  if (primeiraInativacao.error) throw primeiraInativacao.error;

  return {
    semanas, carteiras, streaks, conquistas, compras, loja, motds, warns, aniversarios, quizzes,
    inativacoes,
    inicioInatividade: primeiraInativacao.data?.[0]?.week_reference ?? null,
    mvps,
    atividades,
    usosDoHelp,
    marcacoesTopson,
    lancamentos,
  };
}

/** Linha de `profiles` do membro, ou null para quem nunca mexeu no próprio perfil. */
export async function getPerfil(discordId) {
  const { data, error } = await getClient()
    .from('profiles')
    .select('discord_id, mensagem, vitrine, ultimo_sync_em')
    .eq('discord_id', String(discordId))
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Estado gravado das insígnias. */
export async function getInsigniasGravadas(discordIds = null) {
  const supabase = getClient();

  return lerTudo(() => {
    const consulta = supabase.from('profile_badges').select('discord_id, badge_key, tier, tier_maximo, valor');
    return (discordIds ? consulta.in('discord_id', discordIds) : consulta).order('discord_id').order('badge_key');
  });
}

export async function gravarInsignias(linhas) {
  const supabase = getClient();

  for (let i = 0; i < linhas.length; i += LOTE_ESCRITA) {
    const { error } = await supabase
      .from('profile_badges')
      .upsert(linhas.slice(i, i + LOTE_ESCRITA), { onConflict: 'discord_id,badge_key' });

    if (error) throw error;
  }
}

/** Só insere: tier já registrado mantém a data em que foi alcançado da primeira vez. */
export async function registrarTiersAlcancados(tiers) {
  const supabase = getClient();

  for (let i = 0; i < tiers.length; i += LOTE_ESCRITA) {
    const { error } = await supabase
      .from('profile_badge_tiers')
      .upsert(tiers.slice(i, i + LOTE_ESCRITA), { onConflict: 'discord_id,badge_key,tier', ignoreDuplicates: true });

    if (error) throw error;
  }
}

/**
 * Espelha a lista do cargo: rodar a quarta de novo com o ranking virado tira quem saiu dela, como o
 * cargo faz. Insere antes de limpar, para uma falha no meio nunca deixar a semana vazia — semana
 * faltando quebra a Dinastia de todo mundo. `week_start` é a quinta, igual ao histórico importado.
 */
export async function gravarMvpsDaSemana(weekStart, discordIds) {
  const supabase = getClient();
  const semana = String(weekStart).slice(0, 10);
  const ids = [...new Set(discordIds.map(String))];

  const { error: erroInsercao } = await supabase
    .from('weekly_mvp_history')
    .upsert(ids.map(discord_id => ({ week_start: semana, discord_id })), {
      onConflict: 'week_start,discord_id',
      ignoreDuplicates: true,
    });

  if (erroInsercao) throw erroInsercao;

  const { error: erroLimpeza } = await supabase
    .from('weekly_mvp_history')
    .delete()
    .eq('week_start', semana)
    .not('discord_id', 'in', `(${ids.join(',')})`);

  if (erroLimpeza) throw erroLimpeza;
}

// Quem já foi gravado neste processo: o .help é chamado muitas vezes e só a primeira importa.
const jaUsaramHelp = new Set();

/** Primeira vez que o membro usa o .help (Curioso). Só insere: a data gravada é a do primeiro uso. */
export async function registrarUsoDoHelp(discordId) {
  const id = String(discordId);
  if (jaUsaramHelp.has(id)) return;

  const { error } = await getClient()
    .from('help_usage')
    .upsert({ discord_id: id }, { onConflict: 'discord_id', ignoreDuplicates: true });

  if (error?.code === 'PGRST205') throw new Error('tabela help_usage não existe - rode docs/sql/insignias.sql');
  if (error) throw error;

  jaUsaramHelp.add(id);
}

/** Primeiro dia em que o contador de uma insígnia ligou. Só insere: religar o bot não muda a data. */
export async function registrarLancamento(badgeKey, dia) {
  const { error } = await getClient()
    .from('profile_badge_launches')
    .upsert({ badge_key: badgeKey, dia }, { onConflict: 'badge_key', ignoreDuplicates: true });

  if (error) throw error;
}

/** `[{ discord_id, dia }]` de quem marcou o Topson. O mesmo dia repetido não duplica. */
export async function registrarMarcacoesTopson(linhas) {
  const { error } = await getClient()
    .from('topson_mentions')
    .upsert(linhas, { onConflict: 'discord_id,dia', ignoreDuplicates: true });

  if (error) throw error;
}

/** O que o contador já somou de mensagem e call, para o ciclo somar por cima. */
export async function getAtividadeContada(discordIds) {
  const { data, error } = await getClient()
    .from('player_activity')
    .select('discord_id, mensagens_contadas, segundos_call_contados')
    .in('discord_id', discordIds);

  if (error) throw error;
  return data ?? [];
}

// Só as colunas *_contadas: *_iniciais são a exportação do Apolo e um upsert com elas as zeraria.
// Ler-somar-gravar é seguro porque ninguém digita as *_contadas e o contador não roda em dev.
export async function gravarAtividadeContada(linhas) {
  const { error } = await getClient().from('player_activity').upsert(linhas, { onConflict: 'discord_id' });
  if (error) throw error;
}
