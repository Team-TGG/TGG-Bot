// Acesso ao Supabase do domínio de tickets: `ticket_queue`, `ticket_activity` e a view
// `vw_ticket_pontos`. A regra (detectar autor, ordenar, pontuar) mora em
// services/ticketQueue.js — aqui é só leitura e escrita.
import { getClient } from './db.js';

/** Tickets abertos, com a pontuação da view já junto. Ordenado do maior ponto para o menor. */
export async function getTicketsAbertos() {
  const supabase = getClient();

  const { data: tickets, error } = await supabase
    .from('ticket_queue')
    .select('*')
    .is('fechado_em', null);

  if (error) throw error;
  if (!tickets || tickets.length === 0) return [];

  const { data: pontos, error: erroPontos } = await supabase
    .from('vw_ticket_pontos')
    .select('*')
    .in('discord_id', tickets.map(t => t.opener_discord_id));

  if (erroPontos) throw erroPontos;

  const porPessoa = new Map((pontos ?? []).map(p => [p.discord_id, p]));

  // Empate desempata por quem abriu o ticket antes. Sem isso a ordem de dois empatados dependia
  // do que o Postgres devolvesse primeiro, e podia trocar de um dia para o outro sem nada ter
  // acontecido — o canal seria renomeado à toa e as duas pessoas avisadas de uma mudança falsa.
  return tickets
    .map(t => ({ ...t, pontuacao: porPessoa.get(t.opener_discord_id) ?? null }))
    .sort((a, b) => {
      const diferenca = (b.pontuacao?.pontos ?? 0) - (a.pontuacao?.pontos ?? 0);
      if (diferenca !== 0) return diferenca;
      return new Date(a.aberto_em) - new Date(b.aberto_em);
    });
}

/**
 * Reabre ticket cujo canal voltou para a categoria.
 *
 * Sem isso o canal movido para fora e de volta ficava fechado para sempre: a linha já existe,
 * então o insert com `ignoreDuplicates` a ignora calado e nada a traz de volta.
 */
export async function reabrirTickets(channelIds) {
  if (channelIds.length === 0) return 0;

  const supabase = getClient();

  const { data, error } = await supabase
    .from('ticket_queue')
    .update({ fechado_em: null, atualizado_em: new Date().toISOString() })
    .in('channel_id', channelIds)
    .not('fechado_em', 'is', null)
    .select('channel_id');

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Os três campos que o ciclo precisa em memória: quem conta ponto, em que canal, e de quem é a
 * cobrança. Puxar a linha inteira de cada ticket a cada 5 min seria desperdício.
 */
export async function getTicketsAbertosBasico() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('ticket_queue')
    .select('channel_id, opener_discord_id, responsavel_discord_id')
    .is('fechado_em', null);

  if (error) throw error;
  return data ?? [];
}

export async function getTicket(channelId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('ticket_queue')
    .select('*')
    .eq('channel_id', channelId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Cria a linha do ticket sem tocar em quem já existe.
 *
 * `ignoreDuplicates` é o ponto: reimportar não pode reescrever `responsavel_discord_id` nem o
 * estado da conversa. Um upsert normal apagaria quem já tinha pegado o ticket.
 *
 * Devolve os `channel_id` que realmente entraram, não a contagem: é o que diz em quais canais o
 * card de "assumir" deve ser postado. Com a contagem, a reconciliação não teria como distinguir
 * ticket novo de ticket que já estava lá.
 */
export async function inserirTicketsNovos(linhas) {
  if (linhas.length === 0) return [];

  const supabase = getClient();

  const { data, error } = await supabase
    .from('ticket_queue')
    .upsert(linhas, { onConflict: 'channel_id', ignoreDuplicates: true })
    .select('channel_id');

  if (error) throw error;
  return (data ?? []).map(l => l.channel_id);
}

/** Mesma regra do anterior: quem já tem linha mantém o que você digitou lá. */
export async function garantirAtividade(discordIds) {
  if (discordIds.length === 0) return 0;

  const supabase = getClient();

  const { data, error } = await supabase
    .from('ticket_activity')
    .upsert(
      [...new Set(discordIds)].map(discord_id => ({ discord_id })),
      { onConflict: 'discord_id', ignoreDuplicates: true }
    )
    .select('discord_id');

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Marca o responsável só se ainda não houver um.
 *
 * A condição no `update` é o que resolve dois cliques ao mesmo tempo: o segundo não encontra
 * linha e volta `null`, em vez de sobrescrever quem chegou primeiro. Mesmo truque da decisão de
 * justificativa.
 */
export async function definirResponsavel(channelId, discordId) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('ticket_queue')
    .update({ responsavel_discord_id: discordId, atualizado_em: new Date().toISOString() })
    .eq('channel_id', channelId)
    .is('responsavel_discord_id', null)
    .is('fechado_em', null)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Tickets em que **o autor** falou por último há mais de `limiteISO` e o responsável ainda não
 * respondeu nem foi avisado desde então.
 *
 * Os quatro filtros ficam no Postgres de propósito. `ultima_msg_lado = 'autor'` é o mais
 * importante: como sempre existe um último lado, sem ele a consulta devolvia todo ticket parado
 * e a cobrança virava um relógio perpétuo. Staff falou por último = ninguém está devendo nada.
 */
export async function getTicketsPendentes(limiteISO) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('ticket_queue')
    .select('*')
    .is('fechado_em', null)
    .eq('ultima_msg_lado', 'autor')
    .not('responsavel_discord_id', 'is', null)
    .lt('ultima_msg_em', limiteISO)
    .or(`ultimo_aviso_em.is.null,ultimo_aviso_em.lt.${limiteISO}`);

  if (error) throw error;
  return data ?? [];
}

export async function atualizarTicket(channelId, campos) {
  const supabase = getClient();

  const { error } = await supabase
    .from('ticket_queue')
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq('channel_id', channelId);

  if (error) throw error;
}

/** Canal que sumiu (Ticket Tool apagou) ou saiu da categoria vira fechado, não some da tabela. */
export async function fecharTickets(channelIds) {
  if (channelIds.length === 0) return 0;

  const supabase = getClient();
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from('ticket_queue')
    .update({ fechado_em: agora, atualizado_em: agora })
    .in('channel_id', channelIds)
    .is('fechado_em', null)
    .select('channel_id');

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Soma mensagens e segundos de call na conta de uma pessoa.
 *
 * A soma acontece no Postgres (`incrementar_atividade_ticket`), não aqui: ler-somar-gravar
 * sobrescreveria o valor que o usuário digitasse no Supabase entre a leitura e a gravação, que
 * é exatamente o que ele faz para preencher a base da planilha.
 */
export async function incrementarAtividade(discordId, { mensagens = 0, segundos = 0 }) {
  if (mensagens === 0 && segundos === 0) return;

  const supabase = getClient();

  const { error } = await supabase.rpc('incrementar_atividade_ticket', {
    p_discord_id: discordId,
    p_mensagens: mensagens,
    p_segundos: segundos,
  });

  if (error) throw error;
}
