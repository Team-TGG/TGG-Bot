import { getTicketsAbertosComAvisos, atualizarTicket } from '../tickets.js';
import { getMembrosPresentes } from './ticketQueue.js';
import { discord as discordConfig } from '../../config/index.js';

/**
 * Ticket órfão — o canal continua aberto e quem abriu já não está no servidor.
 *
 * Roda junto do filtro de inatividade, às 07:00. O aviso vai no próprio ticket, marcando o
 * responsável: é ele quem decide fechar, e a informação só faz sentido ao lado da conversa.
 *
 * **Avisa uma vez, não todo dia.** `ticket_queue.aviso_saiu_em` é o carimbo. Sem ele o
 * responsável levaria o mesmo ping toda manhã por um ticket que ele pode estar segurando de
 * propósito — e um aviso repetido treina a staff a ignorar o canal, que é o oposto do que ele
 * existe para fazer. Se a pessoa voltar ao servidor, o carimbo é apagado e um novo sumiço avisa
 * de novo.
 *
 * O bot **não fecha nem apaga o canal**: os tickets são do Ticket Tool, e aqui só se observa.
 */

/** Uma requisição de gateway resolve a lista inteira; ver `getMembrosPresentes`. */
export async function avisarTicketsOrfaos(client) {
  const guild = client.guilds.cache.get(discordConfig.guildId);
  if (!guild) throw new Error('Guild não encontrada');

  let tickets;

  try {
    tickets = await getTicketsAbertosComAvisos();
  } catch (err) {
    // Sem o carimbo o aviso sairia todo dia para o mesmo ticket. Melhor não começar.
    if (err?.code !== '42703') throw err;

    console.error(
      '[TICKET ORFAO] ticket_queue não tem a coluna aviso_saiu_em (timestamptz) — rodada cancelada.'
    );
    return { avisados: [], voltaram: 0, motivo: 'SEM_COLUNA' };
  }

  if (!tickets.length) return { avisados: [], voltaram: 0 };

  const presentes = await getMembrosPresentes(guild, tickets.map(t => t.opener_discord_id));

  // Não deu para conferir: acusar sem leitura marcaria todo mundo como fora do servidor e
  // encheria os tickets de aviso falso. Amanhã tenta de novo.
  if (!presentes) {
    console.warn('[TICKET ORFAO] não foi possível conferir quem saiu - rodada cancelada');
    return { avisados: [], voltaram: 0, motivo: 'SEM_LEITURA' };
  }

  const avisados = [];
  let voltaram = 0;

  for (const ticket of tickets) {
    const saiu = !presentes.has(ticket.opener_discord_id);

    // Voltou para o servidor: limpa o carimbo para que um novo sumiço volte a avisar.
    if (!saiu) {
      if (!ticket.aviso_saiu_em) continue;

      await atualizarTicket(ticket.channel_id, { aviso_saiu_em: null })
        .catch(err => console.warn(`[TICKET ORFAO] falha ao limpar ${ticket.channel_id}: ${err.message}`));
      voltaram++;
      continue;
    }

    if (ticket.aviso_saiu_em) continue;

    const canal = guild.channels.cache.get(ticket.channel_id);
    if (!canal) continue;

    const enviado = await canal.send({
      content: montarAviso(ticket),
      allowedMentions: ticket.responsavel_discord_id
        ? { users: [ticket.responsavel_discord_id] }
        : { parse: [] },
    }).then(() => true).catch(err => {
      console.warn(`[TICKET ORFAO] falha ao avisar em ${canal.name}: ${err.message}`);
      return false;
    });

    // Carimba só depois de a mensagem entrar: falhar aqui tem que repetir amanhã, não engolir o
    // aviso e deixar o ticket órfão parado sem ninguém saber.
    if (!enviado) continue;

    await atualizarTicket(ticket.channel_id, { aviso_saiu_em: new Date().toISOString() })
      .catch(err => console.error(`[TICKET ORFAO] falha ao carimbar ${ticket.channel_id}: ${err.message}`));

    avisados.push({
      channelId: ticket.channel_id,
      openerId: ticket.opener_discord_id,
      responsavelId: ticket.responsavel_discord_id,
    });
  }

  if (avisados.length || voltaram) {
    console.log(`[TICKET ORFAO] ${avisados.length} aviso(s) de autor fora do servidor, ${voltaram} voltaram`);
  }

  return { avisados, voltaram };
}

function montarAviso(ticket) {
  const quem = ticket.responsavel_discord_id ? `<@${ticket.responsavel_discord_id}>` : '';

  // O nick do canal vai junto porque a menção de quem saiu costuma aparecer como um ID cru para
  // quem lê — sem ele a staff não sabe de quem é o ticket sem abrir o histórico.
  const autor = ticket.nick
    ? `**${ticket.nick}** (<@${ticket.opener_discord_id}>)`
    : `<@${ticket.opener_discord_id}>`;

  return (
    `${quem}\n\n` +
    `🚪 ${autor} **não está mais no servidor** e este ticket continua aberto.\n\n` +
    'Vale fechar o ticket, ou confirmar antes se a saída foi intencional.'
  );
}
