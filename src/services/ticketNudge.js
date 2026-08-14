// Avisos por DM do ticket. Dois caminhos, com públicos e gatilhos diferentes:
//
//   staff  -> cobrança por tempo: o autor escreveu e o responsável não respondeu (avisarPendentes)
//   autor  -> só quando é mencionado no próprio ticket, um ping = uma DM (avisarPingDoAutor)
//
// A assimetria é o conserto de um erro do desenho anterior, que cobrava os dois lados por tempo.
// Como sempre existe um "último lado", nunca havia silêncio: todo ticket parado gerava DM para
// alguém, para sempre. A staff deve resposta; quem está na fila não deve nada.
//
// Assunto separado dos contadores de propósito: `ticketActivity` mede quanto a pessoa interage
// para ordenar a fila, aqui é comunicação. Os dois leem mensagem, mas mudam por motivos
// diferentes — mexer no limiar de espera não tem nada a ver com mexer na pontuação.
import { EmbedBuilder } from 'discord.js';
import { getTicketsPendentes, atualizarTicket } from '../tickets.js';
import { discord as discordConfig } from '../../config/index.js';

export const LIMITE_SEM_RESPOSTA_MS = 60 * 60 * 1000;

// Janela de silêncio: das 20h às 08h nenhuma DM de ticket sai, nem para staff nem para autor.
// Usa o fuso local do processo, como o resto dos cálculos de data do bot — se a VM não estiver
// em America/Sao_Paulo, a janela escorrega junto.
export const SILENCIO_INICIO_H = 20;
export const SILENCIO_FIM_H = 8;

export function emHorarioDeSilencio(agora = new Date()) {
  const hora = agora.getHours();
  return hora >= SILENCIO_INICIO_H || hora < SILENCIO_FIM_H;
}

// Última mensagem de cada ticket, à espera do flush. Mesma razão dos contadores: gravar a cada
// mensagem seria uma ida ao banco por linha digitada, para um campo lido de hora em hora.
const ultimaMensagem = new Map(); // channelId -> { em, lado, id }

/**
 * Registra de que lado veio a mensagem. `ehStaff` decide o lado, não o responsável cadastrado:
 * decisão do usuário (14/08/2026) — resposta de qualquer staff zera a pendência, porque o que
 * importa é a pessoa não ficar sem resposta, não vigiar quem respondeu.
 */
export function registrarMensagemDeTicket(message, { ehStaff, ehAutor }) {
  if (!ehStaff && !ehAutor) return;

  ultimaMensagem.set(message.channelId, {
    em: new Date(message.createdTimestamp).toISOString(),
    lado: ehStaff ? 'responsavel' : 'autor',
    id: message.id,
  });
}

/**
 * Grava o estado da conversa e zera o aviso.
 *
 * `ultimo_aviso_em: null` é o que faz a cobrança recomeçar: sem isso, quem respondeu depois de já
 * ter sido cutucado continuaria dentro da janela de silêncio do próprio aviso, e o outro lado só
 * seria avisado uma hora depois do que devia.
 */
export async function gravarConversas() {
  if (ultimaMensagem.size === 0) return;

  const pendentes = new Map(ultimaMensagem);
  ultimaMensagem.clear();

  for (const [channelId, dados] of pendentes) {
    try {
      await atualizarTicket(channelId, {
        ultima_msg_em: dados.em,
        ultima_msg_lado: dados.lado,
        ultima_msg_id: dados.id,
        ultimo_aviso_em: null,
      });
    } catch (err) {
      console.error(`[TICKET AVISO] falha ao gravar a conversa de ${channelId}: ${err.message}`);
    }
  }
}

function linkDaMensagem(channelId, messageId) {
  const base = `https://discord.com/channels/${discordConfig.guildId}/${channelId}`;
  return messageId ? `${base}/${messageId}` : base;
}

function formatarEspera(ms) {
  const horas = Math.floor(ms / 3_600_000);
  if (horas >= 1) return `${horas}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

/**
 * Avisa a staff responsável de ticket parado. Roda junto do ciclo dos contadores.
 *
 * Só cobra a staff: decisão do usuário (14/08/2026). O autor do ticket é avisado por outro
 * caminho, `avisarPingDoAutor`, e nunca por tempo — ele não deve nada a ninguém.
 */
export async function avisarPendentes(client) {
  if (emHorarioDeSilencio()) return;

  const limite = new Date(Date.now() - LIMITE_SEM_RESPOSTA_MS).toISOString();

  let tickets;
  try {
    tickets = await getTicketsPendentes(limite);
  } catch (err) {
    console.error(`[TICKET AVISO] falha ao buscar pendentes: ${err.message}`);
    return;
  }

  let avisados = 0;

  for (const ticket of tickets) {
    const user = await client.users.fetch(ticket.responsavel_discord_id).catch(() => null);
    if (!user) continue;

    const espera = formatarEspera(Date.now() - new Date(ticket.ultima_msg_em).getTime());

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('⏳ Ticket esperando resposta')
      .setDescription(
        `<@${ticket.opener_discord_id}> escreveu no ticket dele há **${espera}** e ainda não foi ` +
        `respondido.\n\nVocê é o responsável por esse ticket.\n\n` +
        `[Ir para a mensagem](${linkDaMensagem(ticket.channel_id, ticket.ultima_msg_id)})`
      )
      .setTimestamp();

    const entregue = await user.send({ embeds: [embed] })
      .then(() => true)
      .catch(() => {
        console.log(`[TICKET AVISO] DM bloqueada: ${ticket.responsavel_discord_id}`);
        return false;
      });

    // Carimba mesmo se a DM não entrou. Sem isso, quem tem DM fechada seria reprocessado a cada
    // ciclo para sempre — uma tentativa falha por hora é o mesmo efeito prático, sem o ruído.
    await atualizarTicket(ticket.channel_id, { ultimo_aviso_em: new Date().toISOString() })
      .catch(err => console.error(`[TICKET AVISO] falha ao carimbar ${ticket.channel_id}: ${err.message}`));

    if (entregue) avisados++;
  }

  if (avisados > 0) console.log(`[TICKET AVISO] ${avisados} aviso(s) de resposta pendente`);
}

/**
 * DM para o autor do ticket quando ele é mencionado no próprio ticket. Um ping, uma DM.
 *
 * Vai na hora, não pelo ciclo: ping é evento pontual, e juntar vários numa mensagem só
 * contraria a regra de um por um. É o único aviso que o autor recebe — por tempo ele nunca é
 * cobrado.
 */
export async function avisarPingDoAutor(message, ticket) {
  if (message.author.id === ticket.opener_discord_id) return;
  if (!message.mentions.users.has(ticket.opener_discord_id)) return;
  if (emHorarioDeSilencio()) return;

  const user = await message.client.users.fetch(ticket.opener_discord_id).catch(() => null);
  if (!user) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔔 Te chamaram no seu ticket')
    .setDescription(
      `${message.author} te mencionou no seu ticket de entrada na guilda.\n\n` +
      `[Ir para a mensagem](${linkDaMensagem(message.channelId, message.id)})`
    )
    .setTimestamp();

  await user.send({ embeds: [embed] })
    .catch(() => console.log(`[TICKET AVISO] DM de ping bloqueada: ${ticket.opener_discord_id}`));
}
