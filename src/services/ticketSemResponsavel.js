// Cobrança do `@auxiliar` em ticket que ninguém assumiu: a cada 2h, no próprio ticket.
//
// Assunto separado de `ticketNudge`, embora os dois cobrem a staff, porque as perguntas são
// diferentes e mudam por motivos diferentes: lá o ticket **tem** dono e ele está devendo uma
// resposta; aqui ninguém pegou o ticket ainda, e não há a quem mandar DM — a cobrança só pode
// ser um ping no canal, para o cargo inteiro.
//
// Decisão do usuário (23/09/2026): repete enquanto ninguém assumir, mas só das 08h às 20h — a
// mesma janela de silêncio das DMs de ticket, pelo mesmo motivo (não acordar ninguém por um
// ticket que espera desde ontem).
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getTicketsSemResponsavel, atualizarTicket } from '../tickets.js';
import { emHorarioDeSilencio } from './ticketNudge.js';
import { discord as discordConfig, runtime, tickets as ticketsConfig } from '../../config/index.js';

export const INTERVALO_COBRANCA_MS = 2 * 60 * 60 * 1000;

function montarCobranca(ticket) {
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('🎫 Ticket ainda sem responsável')
    .setDescription(
      `Ninguém assumiu o ticket de <@${ticket.opener_discord_id}>.\n\n` +
      'Quem assumir passa a receber o aviso por DM quando ele ficar sem resposta.'
    );

  // Botão junto do ping, e não só o ping: em ticket com dias de conversa o card original fica
  // longe demais para a staff rolar até ele. Botões antigos continuam valendo — `definirResponsavel`
  // só grava com `responsavel_discord_id is null`, então o card de cima e este não se atropelam.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_assumir')
      .setLabel('Assumir ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🙋')
  );

  return {
    content: `<@&${ticketsConfig.auxiliarRoleId}>`,
    embeds: [embed],
    components: [row],
    allowedMentions: { roles: [ticketsConfig.auxiliarRoleId] },
  };
}

/**
 * Uma passada da cobrança. Chamada pelo ciclo de 1 min, que é o que dá a resolução de 2h sem
 * cron próprio: a consulta só devolve quem já passou do intervalo, então rodar de minuto em
 * minuto custa uma leitura e não gera mensagem nenhuma fora da hora.
 */
export async function cobrarTicketsSemResponsavel(client) {
  if (!ticketsConfig.auxiliarRoleId) return 0;
  if (emHorarioDeSilencio()) return 0;

  const limite = new Date(Date.now() - INTERVALO_COBRANCA_MS).toISOString();

  let tickets;
  try {
    tickets = await getTicketsSemResponsavel(limite);
  } catch (err) {
    console.error(`[TICKET SEM DONO] falha ao buscar: ${err.message}`);
    return 0;
  }

  // Sem a coluna a rotina não tem memória: o ping sairia, o carimbo falharia, e o cargo seria
  // marcado a cada ciclo de 1 min. Melhor não começar — e dizer qual SQL falta.
  if (tickets === null) {
    console.error(
      '[TICKET SEM DONO] ticket_queue não tem a coluna aviso_sem_responsavel_em (timestamptz) — ' +
      'cobrança desligada. SQL: alter table ticket_queue add column aviso_sem_responsavel_em timestamptz;'
    );
    return 0;
  }

  const guild = client.guilds.cache.get(discordConfig.guildId);
  if (!guild) return 0;

  let cobrados = 0;

  for (const ticket of tickets) {
    const canal = guild.channels.cache.get(ticket.channel_id);
    if (!canal) continue;

    // O ciclo de 1 min roda em dev, mas marcar um cargo inteiro num canal de produção a partir do
    // processo local não — mesma regra do aviso de modo da semana e do recálculo por fechamento.
    // Sem carimbar: em dev o estado do banco continua sendo o da produção.
    if (runtime.isDev) {
      console.log(`[TICKET SEM DONO] dev: cobraria o @auxiliar em ${canal.name}`);
      continue;
    }

    const enviado = await canal.send(montarCobranca(ticket))
      .then(() => true)
      .catch(err => {
        console.warn(`[TICKET SEM DONO] falha ao cobrar em ${canal.name}: ${err.message}`);
        return false;
      });

    // Carimba só depois de a mensagem entrar: falhar aqui tem que repetir na próxima janela, não
    // adiar a cobrança por 2h por causa de um erro do Discord.
    if (!enviado) continue;

    await atualizarTicket(ticket.channel_id, { aviso_sem_responsavel_em: new Date().toISOString() })
      .catch(err => console.error(`[TICKET SEM DONO] falha ao carimbar ${ticket.channel_id}: ${err.message}`));

    cobrados++;
  }

  if (cobrados > 0) console.log(`[TICKET SEM DONO] ${cobrados} ticket(s) sem responsável cobrado(s)`);

  return cobrados;
}
