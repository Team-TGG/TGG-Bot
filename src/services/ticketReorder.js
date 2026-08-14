// Recálculo da ordem da fila: pontuação -> posição -> nome e ordem dos canais.
//
// Roda uma vez por dia. Não é preguiça: renomear canal é limitado a **2 vezes por 10 minutos por
// canal** no Discord, então recalcular a cada mensagem trancaria os nomes na terceira tentativa.
// O nome é foto do último recálculo, e o usuário aceitou isso explicitamente (14/08/2026).
import { getTicketsAbertos, atualizarTicket } from '../tickets.js';
import { lerNomeDoTicket } from './ticketQueue.js';
import { discord as discordConfig } from '../../config/index.js';

/**
 * O nick sai do **nome atual do canal**, não da coluna `nick`.
 *
 * É o que faz correção manual da staff sobreviver ao cron: renomear `guild-fulano-3` para
 * `guild-fulaninho-3` no Discord passa a valer no próximo recálculo, sem ninguém editar o banco.
 * Sem nick legível (ticket novo ainda com o nome que o Ticket Tool deu) o canal não é renomeado —
 * `guild-null-7` seria pior que deixar como está.
 */
function nomeAlvo(canal, ticket, posicao) {
  const { nick } = lerNomeDoTicket(canal.name);
  const usar = nick ?? ticket.nick;
  if (!usar) return null;

  return `guild-${usar}-${posicao}`;
}

function montarAvisoDeMudanca(anterior, nova) {
  const subiu = anterior !== null && nova < anterior;
  const seta = anterior === null ? '📍' : subiu ? '⬆️' : '⬇️';

  const de = anterior === null ? '' : ` (antes: ${anterior})`;

  return (
    `${seta} **Sua posição na fila agora é ${nova}**${de}\n` +
    'A ordem é recalculada todo dia, conforme sua interação no servidor — mensagens e tempo em call.\n\n' +
    `${seta} **Your position in the queue is now ${nova}**${de}\n` +
    'The order is recalculated every day, based on your interaction in the server — messages and voice time.'
  );
}

/**
 * Recalcula a fila inteira e aplica no Discord.
 *
 * Devolve o que mudou para quem chamou reportar. Não manda DM nenhuma — decisão do usuário
 * (14/08/2026): o aviso de posição é assunto do canal, e uma DM diária para 60 pessoas viraria
 * spam do bot.
 */
export async function recalcularOrdemDaFila(client) {
  const guild = client.guilds.cache.get(discordConfig.guildId);
  if (!guild) throw new Error('Guild não encontrada');

  const tickets = await getTicketsAbertos();
  if (tickets.length === 0) return { total: 0, mudaram: 0, renomeados: 0, semNick: 0, sumidos: 0 };

  const posicoes = [];
  let mudaram = 0;
  let renomeados = 0;
  let semNick = 0;
  let sumidos = 0;

  for (const [indice, ticket] of tickets.entries()) {
    const posicao = indice + 1;
    const canal = guild.channels.cache.get(ticket.channel_id);

    // Canal que sumiu entre a leitura e agora: a reconciliação fecha no próximo ciclo, aqui só
    // não estoura.
    if (!canal) {
      sumidos++;
      continue;
    }

    const anterior = ticket.posicao ?? null;
    const pontos = ticket.pontuacao?.pontos ?? 0;

    await atualizarTicket(ticket.channel_id, { posicao, pontos })
      .catch(err => console.error(`[TICKET ORDEM] falha ao gravar ${canal.name}: ${err.message}`));

    const alvo = nomeAlvo(canal, ticket, posicao);
    if (!alvo) semNick++;

    if (alvo && alvo !== canal.name) {
      const ok = await canal.setName(alvo)
        .then(() => true)
        .catch(err => {
          console.warn(`[TICKET ORDEM] falha ao renomear ${canal.name}: ${err.message}`);
          return false;
        });
      if (ok) renomeados++;
    }

    posicoes.push({ channel: canal.id, position: indice });

    // Só quem mudou de lugar é avisado, e só no canal. Postar em todos todo dia treinaria a
    // fila a ignorar a mensagem, que é o oposto do que ela existe para fazer.
    if (anterior !== posicao) {
      mudaram++;
      await canal.send({ content: montarAvisoDeMudanca(anterior, posicao) })
        .catch(err => console.warn(`[TICKET ORDEM] falha ao avisar em ${canal.name}: ${err.message}`));
    }
  }

  // Uma chamada para reordenar tudo, em vez de um PATCH por canal: `setPositions` manda a lista
  // inteira de uma vez.
  if (posicoes.length > 0) {
    await guild.channels.setPositions(posicoes)
      .catch(err => console.error(`[TICKET ORDEM] falha ao reordenar os canais: ${err.message}`));
  }

  console.log(`[TICKET ORDEM] ${tickets.length} ticket(s), ${mudaram} mudaram de posição, ${renomeados} renomeado(s)`);

  return { total: tickets.length, mudaram, renomeados, semNick, sumidos };
}
