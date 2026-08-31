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
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getTicketsPendentes, atualizarTicket, getTicket } from '../tickets.js';
import { createErrorEmbed, createWarningEmbed } from '../../utils/discordUtils.js';
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

    // A mensagem do autor nem sempre pede resposta — um gif, um emoji, um "obrigado". Sem uma
    // saída, o bot cobra de hora em hora por algo que já foi resolvido. O id da mensagem vai no
    // customId para o botão valer só para *esta* mensagem: se o autor escrever de novo depois, o
    // clique atrasado não pode silenciar a nova.
    const linha = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_lido_${ticket.channel_id}_${ticket.ultima_msg_id ?? '0'}`)
        .setLabel('Mensagem lida, não precisa resposta')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✅')
    );

    const entregue = await user.send({ embeds: [embed], components: [linha] })
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

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔔 Te chamaram no seu ticket')
    .setDescription(
      `${message.author} te mencionou no seu ticket de entrada na guilda.\n\n` +
      `[Ir para a mensagem](${linkDaMensagem(message.channelId, message.id)})`
    )
    .setTimestamp();

  const user = await message.client.users.fetch(ticket.opener_discord_id).catch(() => null);

  const entregue = user
    ? await user.send({ embeds: [embed] }).then(() => true).catch(() => false)
    : false;

  if (entregue) return;

  console.log(`[TICKET AVISO] DM de ping bloqueada: ${ticket.opener_discord_id}`);
  await avisarDmFechada(message, ticket);
}

/**
 * Responde no próprio ticket quando o ping não virou DM.
 *
 * Sem isso a menção falha em silêncio: quem chamou acha que avisou, o autor nunca soube, e o
 * ticket fica parado esperando um lado que não foi cutucado. O retorno vai no canal, e não na
 * DM de quem pingou, porque aí serve para a staff toda — e porque a DM de quem pingou pode
 * estar fechada do mesmo jeito.
 *
 * Um ping falho, um retorno: é o espelho da regra de "um ping, uma DM". A mensagem só aparece
 * quando a DM realmente não entrou, então repetir é sinal de que ninguém leu o primeiro.
 */
async function avisarDmFechada(message, ticket) {
  const embed = createWarningEmbed(
    'Não consegui avisar por DM',
    `<@${ticket.opener_discord_id}> está com a DM fechada para o bot, então **não foi avisado** ` +
    'da menção. Se precisar dele aqui, vale chamar por outro caminho.'
  );

  await message.reply({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch(err => console.warn(`[TICKET AVISO] falha ao avisar DM fechada em ${message.channelId}: ${err.message}`));
}

/**
 * Botão "mensagem lida" da DM de cobrança (`ticket_lido_<canal>_<mensagem>`).
 *
 * Marca o lado como `responsavel`, que é o mesmo estado de "a staff já agiu" — a consulta de
 * pendentes deixa de trazer o ticket e nada mais é cobrado. Não foi coluna nova de propósito:
 * `ultima_msg_lado` já significa "quem deu o último passo", e ler a mensagem é um passo. Quando
 * o autor escrever de novo, o campo volta para `autor` e o relógio recomeça sozinho.
 */
export async function handleTicketLido(interaction) {
  await interaction.deferUpdate().catch(err => {
    console.warn(`[TICKET AVISO] deferUpdate falhou: ${err.message}`);
  });

  const [, , channelId, messageId] = interaction.customId.split('_');

  const ticket = await getTicket(channelId);
  if (!ticket) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Ticket não encontrado', 'Ele já foi fechado no cadastro do bot.')],
      components: [],
    }).catch(() => {});
  }

  // Chegou mensagem nova depois do aviso: silenciar aqui esconderia justamente a que ainda não
  // foi vista. O botão vale só para a mensagem que gerou esta DM.
  if (ticket.ultima_msg_id && ticket.ultima_msg_id !== messageId) {
    return interaction.editReply({
      embeds: [createWarningEmbed(
        'Chegou mensagem nova',
        'O autor escreveu de novo depois deste aviso, então não marquei nada. ' +
        'Veja o ticket — o próximo aviso vai apontar para a mensagem mais recente.'
      )],
      components: [],
    }).catch(() => {});
  }

  await atualizarTicket(channelId, { ultima_msg_lado: 'responsavel' });

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Marcado como lido')
    .setDescription(
      'Não vou mais cobrar resposta para essa mensagem.\n\n' +
      'Se o autor escrever de novo, a contagem recomeça.'
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
}
