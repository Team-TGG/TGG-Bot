import { getClient, getCurrentInactivityWeekReference } from './db.js';

/**
 * Blindagem contra inativação — tabela `inactivity_shields`.
 *
 * Duas origens alimentam a mesma tabela:
 *
 * - **Manual**: linha inserida direto no Supabase para membro específico (dono de servidor,
 *   organizador de evento, quem está de licença). `status` já entra como `aprovada` e `weeks`
 *   nulo significa permanente.
 * - **`.justificativa`**: o membro pede, a linha entra como `pendente` e só passa a valer quando
 *   um officer/admin aprova pelos botões no canal da staff.
 *
 * Officer e admin **não** precisam de linha: a rotina de inativação já os pula pelo `users.role`.
 *
 * A cobertura é contada em semanas de inatividade (quarta → quarta): uma blindagem com
 * `week_start = 2026-08-06` e `weeks = 2` cobre as avaliações de referência 06/08 e 13/08.
 */

export const STATUS = {
  PENDENTE: 'pendente',
  APROVADA: 'aprovada',
  RECUSADA: 'recusada',
};

/** Teto de semanas que um membro pode pedir de uma vez. */
export const MAX_SEMANAS = 4;

/** Uma blindagem aprovada cobre a semana avaliada? `weeks` nulo = permanente. */
export function cobreSemana(blindagem, weekReference) {
  if (blindagem.status !== STATUS.APROVADA) return false;
  if (blindagem.weeks === null || blindagem.weeks === undefined) return true;

  const inicio = String(blindagem.week_start).slice(0, 10);
  if (weekReference < inicio) return false;

  const [ano, mes, dia] = inicio.split('-').map(Number);
  const fim = new Date(ano, mes - 1, dia + Number(blindagem.weeks) * 7);

  const m = String(fim.getMonth() + 1).padStart(2, '0');
  const d = String(fim.getDate()).padStart(2, '0');

  // Fim exclusivo: weeks = 1 cobre só a semana que começa em week_start
  return weekReference < `${fim.getFullYear()}-${m}-${d}`;
}

/** Todas as blindagens aprovadas. A tabela é pequena — filtrar em memória sai mais simples. */
export async function getBlindagensAprovadas() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('inactivity_shields')
    .select('*')
    .eq('status', STATUS.APROVADA);

  if (error) throw error;
  return data ?? [];
}

/** Quem está blindado numa semana específica → Map discord_id → blindagem. */
export async function getBlindadosNaSemana(weekReference) {
  const blindagens = await getBlindagensAprovadas();
  const mapa = new Map();

  for (const b of blindagens) {
    if (!cobreSemana(b, weekReference)) continue;

    const id = String(b.discord_id);
    const atual = mapa.get(id);

    // Mais de uma blindagem cobrindo a mesma semana: mostra a permanente, que explica melhor
    // o porquê. Para o efeito prático tanto faz — qualquer uma já protege.
    if (!atual || b.weeks === null) mapa.set(id, b);
  }

  return mapa;
}

/** Pedidos ainda sem decisão. Usado para avisar a staff antes de inativar alguém à toa. */
export async function getBlindagensPendentes() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('inactivity_shields')
    .select('*')
    .eq('status', STATUS.PENDENTE);

  if (error) throw error;
  return data ?? [];
}

export async function getBlindagem(id) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('inactivity_shields')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Já pediu e ainda não foi decidido? Evita a mesma pessoa enfileirar vários pedidos. */
export async function getPedidoPendenteDoMembro(discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('inactivity_shields')
    .select('*')
    .eq('discord_id', String(discordId))
    .eq('status', STATUS.PENDENTE)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

/** Cria o pedido de `.justificativa`. Nasce pendente: só vale depois que a staff aprova. */
export async function criarPedidoDeBlindagem({ discordId, reason, weeks }) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('inactivity_shields')
    .insert({
      discord_id: String(discordId),
      reason,
      weeks: Number(weeks),
      week_start: getCurrentInactivityWeekReference(),
      status: STATUS.PENDENTE,
      requested_by: String(discordId),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Guarda onde o pedido foi anunciado, para os botões poderem editar a mensagem depois. */
export async function registrarMensagemDoPedido(id, channelId, messageId) {
  const supabase = getClient();

  const { error } = await supabase
    .from('inactivity_shields')
    .update({ channel_id: String(channelId), message_id: String(messageId) })
    .eq('id', id);

  if (error) throw error;
}

/**
 * Aprova ou recusa. O `eq('status', PENDENTE)` é o que impede dois membros da staff clicando ao
 * mesmo tempo de gravar decisões diferentes — o segundo não acha linha e recebe `null`.
 */
export async function decidirBlindagem(id, { status, approvedBy }) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('inactivity_shields')
    .update({
      status,
      approved_by: String(approvedBy),
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', STATUS.PENDENTE)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Quem já está na lista de inativos da semana — não dá para inserir duas vezes. */
export async function getInativosDaSemana(weekReference) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('weekly_inactive_players')
    .select('brawlhalla_id, note')
    .eq('week_reference', weekReference);

  if (error) throw error;
  return data ?? [];
}

/** Insere a leva da semana de uma vez. `note` nulo é o que marca "ainda inativo". */
export async function inserirInativos(brawlhallaIds, weekReference) {
  if (!brawlhallaIds.length) return [];

  const supabase = getClient();
  const hoje = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('weekly_inactive_players')
    .insert(brawlhallaIds.map(id => ({
      brawlhalla_id: String(id),
      week_reference: weekReference,
      created_at: hoje,
      note: null,
    })))
    .select();

  if (error) throw error;
  return data ?? [];
}
