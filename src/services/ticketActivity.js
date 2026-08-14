// Contadores de mensagem e de tempo de call de quem tem ticket aberto.
//
// Nada vai para o banco na hora do evento: mensagem e voz acumulam em memória e são gravadas em
// bloco a cada 5 min. Uma escrita por mensagem seria uma ida ao Supabase a cada linha digitada
// por ~60 pessoas, para um número que só é lido uma vez por dia pelo cron de reordenação.
//
// O preço disso é perder até 5 min de contagem se o processo cair, e é preço aceito: a
// pontuação é comparativa (todo mundo perde os mesmos 5 min) e a base de tudo é o que a staff
// digitou à mão.
import { getTicketsAbertosBasico, incrementarAtividade } from '../tickets.js';
import { reconciliarTickets } from './ticketQueue.js';
import { registrarMensagemDeTicket, gravarConversas, avisarPendentes, avisarPingDoAutor } from './ticketNudge.js';
import { discord as discordConfig, STAFF_ROLE_IDS } from '../../config/index.js';

// 1 min: o ciclo em regime é uma consulta só ao Supabase (a reconciliação calcula o diff contra
// a memória e só escreve quando algo mudou), então a frequência custa pouco e ticket novo aparece
// quase na hora. `TICKET_CYCLE_SECONDS` existe para calibrar sem editar código.
const INTERVALO_FLUSH_MS = Math.max(15, Number(process.env.TICKET_CYCLE_SECONDS) || 60) * 1000;

const mensagensPendentes = new Map();  // discordId -> quantidade
const segundosPendentes = new Map();   // discordId -> segundos
const emCall = new Map();              // discordId -> instante da última âncora (ms)

let autoresComTicket = new Set();
let ticketsPorCanal = new Map();       // channelId -> { opener_discord_id, responsavel_discord_id }
let timer = null;

const IDS_DE_STAFF = new Set(Object.values(STAFF_ROLE_IDS));

function somar(mapa, chave, valor) {
  if (valor <= 0) return;
  mapa.set(chave, (mapa.get(chave) ?? 0) + valor);
}

/** Sem argumento consulta o banco; com a lista pronta só refaz os mapas, sem consulta nenhuma. */
export async function recarregarAutores(abertos = null) {
  const linhas = abertos ?? await getTicketsAbertosBasico();

  autoresComTicket = new Set(linhas.map(t => t.opener_discord_id));
  ticketsPorCanal = new Map(linhas.map(t => [t.channel_id, t]));

  return autoresComTicket.size;
}

/**
 * Chamado a cada mensagem do servidor. Faz duas coisas diferentes com a mesma mensagem:
 * conta ponto (só de quem tem ticket aberto, em qualquer canal) e, se for dentro de um ticket,
 * anota de que lado veio para a cobrança de resposta.
 */
export function registrarMensagem(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  if (autoresComTicket.has(message.author.id)) {
    somar(mensagensPendentes, message.author.id, 1);
  }

  const ticket = ticketsPorCanal.get(message.channelId);
  if (!ticket) return;

  registrarMensagemDeTicket(message, {
    ehAutor: message.author.id === ticket.opener_discord_id,
    ehStaff: Boolean(message.member?.roles?.cache?.some(r => IDS_DE_STAFF.has(r.id))),
  });

  // Vai na hora e fora do ciclo: ping é evento pontual, e agrupar no flush juntaria vários
  // numa DM só. Solto porque `registrarMensagem` é síncrono — a mensagem não pode esperar a DM.
  avisarPingDoAutor(message, ticket)
    .catch(err => console.error(`[TICKET AVISO] falha na DM de ping: ${err.message}`));
}

/**
 * Canal de AFK não conta: é literalmente o canal para onde o Discord manda quem parou de
 * interagir, então somar tempo ali seria pagar por ficar longe do teclado.
 */
function contaComoCall(state) {
  if (!state.channelId) return false;
  return state.channelId !== state.guild.afkChannelId;
}

/** Credita o tempo desde a última âncora e reancora no instante dado, sem tirar da call. */
function creditar(discordId, agora) {
  const desde = emCall.get(discordId);
  if (desde === undefined) return;

  somar(segundosPendentes, discordId, Math.floor((agora - desde) / 1000));
  emCall.set(discordId, agora);
}

export function registrarVoz(oldState, newState) {
  const discordId = newState.id ?? oldState.id;
  if (!autoresComTicket.has(discordId)) return;

  const antes = contaComoCall(oldState);
  const depois = contaComoCall(newState);
  const agora = Date.now();

  if (!antes && depois) {
    emCall.set(discordId, agora);
    return;
  }

  if (antes && !depois) {
    creditar(discordId, agora);
    emCall.delete(discordId);
  }

  // Trocar de canal (antes && depois) não mexe em nada: a âncora continua valendo.
}

/**
 * Quem já estava em call quando o bot subiu não gera `voiceStateUpdate` nenhum — sem isso, o
 * tempo de quem entrou antes do restart só começaria a contar quando a pessoa saísse e voltasse.
 */
export function semearCallsEmAndamento(client) {
  let semeados = 0;
  const agora = Date.now();

  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (!autoresComTicket.has(state.id)) continue;
      if (!contaComoCall(state)) continue;

      emCall.set(state.id, agora);
      semeados++;
    }
  }

  return semeados;
}

/**
 * Reconcilia a tabela com a categoria e recarrega a lista de quem é contado.
 *
 * Vem antes de tudo no ciclo: ticket aberto agora só passa a pontuar depois que a linha existe,
 * e a demora máxima para isso é um ciclo. Falhar aqui não pode derrubar o flush — a contagem já
 * acumulada é mais importante que estar em dia com a categoria.
 */
async function sincronizarFila(client) {
  const guild = client.guilds.cache.get(discordConfig.guildId);
  if (!guild) return;

  try {
    const r = await reconciliarTickets(guild);

    if (r.novos > 0 || r.fechados > 0 || r.reabertos > 0) {
      console.log(`[TICKET ATIVIDADE] reconciliação: ${r.novos} novo(s), ${r.reabertos} reaberto(s), ${r.fechados} fechado(s), ${r.semAutor.length} sem autor`);
    }

    // A reconciliação já devolve o estado final — reconsultar aqui seria a segunda leitura
    // idêntica do mesmo ciclo, e é justamente o que precisa sumir para rodar de 1 em 1 min.
    await recarregarAutores(r.abertos);
  } catch (err) {
    console.error(`[TICKET ATIVIDADE] reconciliação falhou: ${err.message}`);

    // Falhou a reconciliação: os mapas em memória podem estar velhos, então vale a consulta
    // direta. Sem isso, uma falha no boot deixaria o bot sem contar ninguém até o ciclo seguinte.
    await recarregarAutores().catch(e => {
      console.warn(`[TICKET ATIVIDADE] falha ao recarregar autores: ${e.message}`);
    });
  }

  // Ticket fechado com a pessoa dentro de uma call: `registrarVoz` deixa de olhar para ela, então
  // a saída nunca seria processada e a âncora ficaria no mapa para sempre, sendo recreditada a
  // cada ciclo. Credita o que ela fez até agora e solta.
  const agora = Date.now();
  for (const discordId of [...emCall.keys()]) {
    if (autoresComTicket.has(discordId)) continue;
    creditar(discordId, agora);
    emCall.delete(discordId);
  }
}

async function flush(client) {
  await sincronizarFila(client);

  const agora = Date.now();

  // Reancora quem ainda está em call: sem isso o tempo de quem passa horas numa call só entraria
  // na conta quando ela terminasse, e um restart no meio jogaria tudo fora.
  for (const discordId of [...emCall.keys()]) creditar(discordId, agora);

  const mensagens = new Map(mensagensPendentes);
  const segundos = new Map(segundosPendentes);
  mensagensPendentes.clear();
  segundosPendentes.clear();

  const ids = new Set([...mensagens.keys(), ...segundos.keys()]);
  if (ids.size > 0) {
    for (const discordId of ids) {
      try {
        await incrementarAtividade(discordId, {
          mensagens: mensagens.get(discordId) ?? 0,
          segundos: segundos.get(discordId) ?? 0,
        });
      } catch (err) {
        // Devolve para a fila em vez de engolir: no próximo flush tenta de novo. Some só se o
        // processo cair antes disso, que é a mesma perda de 5 min já assumida acima.
        somar(mensagensPendentes, discordId, mensagens.get(discordId) ?? 0);
        somar(segundosPendentes, discordId, segundos.get(discordId) ?? 0);
        console.error(`[TICKET ATIVIDADE] falha ao gravar ${discordId}: ${err.message}`);
      }
    }

    console.log(`[TICKET ATIVIDADE] flush: ${ids.size} pessoa(s)`);
  }

  // A conversa é gravada antes da cobrança: quem respondeu neste ciclo tem que sair da lista de
  // pendentes antes de ela ser consultada, senão leva DM por uma resposta que já deu.
  await gravarConversas();
  await avisarPendentes(client);
}

export async function iniciarContadores(client) {
  if (timer) return;

  // A sincronização vem antes do semeio: quem abriu ticket enquanto o bot estava fora precisa
  // estar na lista para que a call em que já está seja ancorada agora, e não só na próxima.
  await sincronizarFila(client);
  const autores = autoresComTicket.size;
  const emCallAgora = semearCallsEmAndamento(client);

  timer = setInterval(() => {
    flush(client).catch(err => console.error('[TICKET ATIVIDADE] flush falhou:', err));
  }, INTERVALO_FLUSH_MS);

  console.log(`[TICKET ATIVIDADE] contadores ativos - ciclo de ${INTERVALO_FLUSH_MS / 1000}s, ${autores} autor(es) com ticket aberto, ${emCallAgora} em call`);
}
