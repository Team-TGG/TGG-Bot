import { EmbedBuilder } from 'discord.js';
import { getTicketsAbertosBasico } from '../tickets.js';
import { CATEGORIA_TICKETS_ID, TITULO_AVISO_PRAZO, jaEntrouNaGuilda } from './ticketQueue.js';
import { discord as discordConfig, ticketSemResposta as config } from '../../config/index.js';

/**
 * Apaga o ticket de quem abriu e não escreveu nada no prazo (decisão do usuário, 21/10/2026).
 *
 * É a exceção ao "o bot não cria nem apaga ticket": o Ticket Tool continua criando, e o bot só
 * apaga este caso. A reconciliação do ciclo de 1 min vê o canal sumir e fecha a linha sozinha.
 *
 * Só a fala de **quem abriu** salva o ticket — staff escrevendo para um candidato que sumiu não
 * conta. O prazo corre do aviso postado no ticket, não da criação do canal: ticket aberto com o
 * bot fora do ar recebe o aviso atrasado, e contar da criação daria a ele menos tempo do que o
 * aviso promete. Ticket sem o aviso é de antes da regra e nunca é apagado por ela.
 */

/** Canais que não precisam ser relidos: o autor já falou, ou o ticket é de antes da regra. */
const resolvidos = new Set();

// Página cheia de mensagens não é ticket abandonado. Paginar só para provar isso é desperdício.
const LIMITE_LEITURA = 100;

const MAX_LINHAS = 25;

export async function apagarTicketsSemResposta(client) {
  const guild = client.guilds.cache.get(discordConfig.guildId);
  if (!guild) throw new Error('Guild não encontrada');

  const prazoMs = config.horas * 60 * 60 * 1000;
  const agora = Date.now();
  const tickets = await getTicketsAbertosBasico();

  const apagados = [];
  const falhas = [];

  for (const ticket of tickets) {
    if (resolvidos.has(ticket.channel_id)) continue;

    const canal = guild.channels.cache.get(ticket.channel_id);
    if (!canal || canal.parentId !== CATEGORIA_TICKETS_ID) continue;

    // O aviso nunca é anterior ao canal: canal mais novo que o prazo não precisa nem ser lido.
    if (agora - canal.createdTimestamp < prazoMs) continue;

    // "entrou" no nome é ticket de quem a staff já aceitou.
    if (jaEntrouNaGuilda(canal.name)) {
      resolvidos.add(ticket.channel_id);
      continue;
    }

    const mensagens = await canal.messages.fetch({ limit: LIMITE_LEITURA }).catch(err => {
      console.warn(`[TICKET SEM RESPOSTA] não li ${canal.name}: ${err.message}`);
      return null;
    });
    if (!mensagens) continue;

    const autorFalou = mensagens.size >= LIMITE_LEITURA ||
      mensagens.some(m => m.author.id === ticket.opener_discord_id);

    const aviso = mensagens.find(m =>
      m.author.id === client.user.id && m.embeds.some(e => e.title === TITULO_AVISO_PRAZO)
    );

    if (autorFalou || !aviso) {
      resolvidos.add(ticket.channel_id);
      continue;
    }

    if (agora - aviso.createdTimestamp < prazoMs) continue;

    const registro = {
      nome: canal.name,
      autorId: ticket.opener_discord_id,
      abertoEm: Math.floor(canal.createdTimestamp / 1000),
    };

    try {
      await canal.delete(`Sem resposta de quem abriu em ${config.horas}h`);
      resolvidos.add(ticket.channel_id);
      apagados.push(registro);
    } catch (err) {
      console.warn(`[TICKET SEM RESPOSTA] não apaguei ${canal.name}: ${err.message}`);
      falhas.push({ ...registro, erro: err.message });
    }
  }

  if (apagados.length || falhas.length) {
    console.log(`[TICKET SEM RESPOSTA] ${apagados.length} apagado(s), ${falhas.length} falha(s)`);
    await registrarNaLog(client, apagados, falhas);
  }

  return { apagados, falhas };
}

/** Sem ping: é registro para a staff, e o autor já não tem o canal para ler. */
async function registrarNaLog(client, apagados, falhas) {
  const canal = config.channelId
    ? await client.channels.fetch(config.channelId).catch(() => null)
    : null;

  if (!canal) {
    console.warn(`[TICKET SEM RESPOSTA] canal de log ${config.channelId} não encontrado - registro pulado`);
    return;
  }

  const linha = r => `**#${r.nome}** — <@${r.autorId}> — aberto <t:${r.abertoEm}:f>`;

  const partes = [];

  if (apagados.length) {
    const linhas = apagados.slice(0, MAX_LINHAS).map(linha);
    if (apagados.length > linhas.length) linhas.push(`… e mais ${apagados.length - linhas.length}`);

    partes.push(
      `Quem abriu não mandou nenhuma mensagem nas primeiras **${config.horas}h**, ` +
      `e estes tickets foram deletados:\n\n${linhas.join('\n')}`
    );
  }

  if (falhas.length) {
    const linhas = falhas.slice(0, MAX_LINHAS).map(f => `${linha(f)} — ${f.erro}`);
    if (falhas.length > linhas.length) linhas.push(`… e mais ${falhas.length - linhas.length}`);

    partes.push(`⚠️ Não consegui deletar (tento de novo na próxima hora):\n\n${linhas.join('\n')}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🗑️ Tickets sem resposta deletados')
    .setDescription(partes.join('\n\n'))
    .setTimestamp();

  await canal.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(err => {
    console.warn(`[TICKET SEM RESPOSTA] falha ao registrar na log: ${err.message}`);
  });
}
