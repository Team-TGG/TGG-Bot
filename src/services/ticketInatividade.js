import { EmbedBuilder } from 'discord.js';
import {
  getTicketsAbertos,
  getUltimaAtividade,
  atualizarTicket,
  limparAvisoDeInatividade,
} from '../tickets.js';
import { getMembrosPresentes } from './ticketQueue.js';
import { discord as discordConfig, ticketInatividade as config } from '../../config/index.js';

/**
 * Filtro de inatividade da fila por tickets — todo dia 07:00.
 *
 * Quem está na posição `posicaoMinima` ou pior e passou `diasParado` dias sem interagir é chamado
 * no próprio ticket. Se não der sinal até a rodada seguinte, o responsável pelo ticket é chamado
 * no lugar dele.
 *
 * **Entrar e sair da régua medem coisas diferentes, de propósito.** Entra quem sumiu do servidor:
 * `ticket_activity.atualizado_em`, a mesma leitura que alimenta a pontuação da fila (mensagem em
 * qualquer canal mais tempo de call). Sai só quem **escreve dentro do próprio ticket** — decisão
 * do usuário (31/08/2026). O aviso faz uma pergunta ("ainda tem interesse?"), e voltar a conversar
 * em outro canal não responde a pergunta: quem só reaparece no servidor continua devendo a
 * resposta de que a staff precisa para decidir a vaga.
 *
 * A saída é gravada **no ciclo de 1 min**, não aqui: `gravarConversas`
 * ([ticketNudge.js](./ticketNudge.js)) devolve os canais em que o autor falou e o ciclo chama
 * `limparAvisoSeAutorFalou`. É o único ponto que enxerga a fala do autor mesmo quando a staff
 * responde logo depois — `ultima_msg_lado` guarda só o último lado.
 *
 * O corte de posição é lido do cálculo vivo (`getTicketsAbertos`, a mesma ordenação do recálculo
 * da fila) e não da coluna `posicao`, que é foto do último recálculo e pode estar um dia
 * atrasada — cobrar alguém por uma posição que ele já não tem seria injusto de um jeito invisível.
 *
 * O estado das duas etapas vive em `ticket_queue.aviso_inatividade_em` e
 * `.aviso_inatividade_staff_em`.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Folga no prazo da escalada.
 *
 * O carimbo de ontem é gravado **depois** do envio (setup da rodada, o send e o update), e a
 * decisão de hoje é tomada **antes** dele. Com as duas rodadas saindo do mesmo cron das 07:00, o
 * intervalo medido é sempre alguns segundos **menor** que as 24h cheias — então a comparação
 * exata nunca fechava no dia seguinte e a escalada só saía no terceiro dia, com 48h. A folga é
 * grande o bastante para absorver atraso de cron e restart, e pequena o bastante para não
 * escalar na mesma rodada em que o membro foi avisado.
 */
const MARGEM_ESCALADA_MS = 60 * 60 * 1000;

/** Teto de linhas por bloco do resumo. Lista cortada tem que dizer que foi cortada. */
const MAX_LINHAS = 20;

function diasDesde(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / DIA_MS;
}

/**
 * Decide o que fazer com cada ticket. Função pura — dá para conferir a regra inteira sem banco
 * nem Discord, que é o único jeito de testar isto sem esperar quatro dias passarem.
 *
 * `acao`: `avisar` (primeiro toque no membro), `escalar` (chamar o responsável) ou `null`.
 * Não existe ação de "saiu da régua": a saída é o autor escrever no ticket, e isso é limpo pelo
 * ciclo de 1 min. Se `aviso_inatividade_em` ainda está de pé, é porque ele não escreveu.
 */
export function decidirAcao(ticket, { posicao, ultimaAtividade, agora = Date.now() }) {
  const avisoEm = ticket.aviso_inatividade_em;

  // Já escalado: a staff foi chamada e o assunto é dela. Sem isto o responsável levaria o mesmo
  // ping todo dia enquanto o ticket não fosse resolvido.
  if (ticket.aviso_inatividade_staff_em) return { acao: null };

  if (avisoEm) {
    const desdeOAviso = agora - new Date(avisoEm).getTime();
    const prazo = config.horasParaEscalar * 60 * 60 * 1000 - MARGEM_ESCALADA_MS;
    if (desdeOAviso < prazo) return { acao: null };

    // Sem checar posição de novo: a pergunta foi feita em público no ticket dele e continua sem
    // resposta. Deixar pendurada porque ele subiu na fila enquanto isso seria pior do que o ping.
    return { acao: 'escalar', parado: diasDesde(ultimaAtividade) };
  }

  if (posicao < config.posicaoMinima) return { acao: null };

  const parado = diasDesde(ultimaAtividade);

  // Sem leitura de atividade não se acusa ninguém: 0 e "não sei" são coisas diferentes.
  if (parado === null || parado < config.diasParado) return { acao: null };

  return { acao: 'avisar', parado };
}

/**
 * Tira da régua quem escreveu no próprio ticket. Chamado pelo ciclo de 1 min com os canais que
 * `gravarConversas` devolveu.
 *
 * Falha aqui é engolida com log: a pessoa seria escalada por uma resposta que deu, e o conserto é
 * ela escrever de novo — mas derrubar o ciclo por causa disso custaria a contagem de todo mundo.
 */
export async function limparAvisoSeAutorFalou(channelIds) {
  if (!channelIds?.length) return 0;

  try {
    const limpos = await limparAvisoDeInatividade(channelIds);
    if (limpos > 0) console.log(`[TICKET INATIVIDADE] ${limpos} responderam no ticket e saíram da régua`);
    return limpos;
  } catch (err) {
    console.error(`[TICKET INATIVIDADE] falha ao limpar aviso: ${err.message}`);
    return 0;
  }
}

function textoParaOMembro(discordId, posicao, parado) {
  const dias = Math.floor(parado);

  return (
    `<@${discordId}>\n\n` +
    `⏳ **Você está há ${dias} dias sem interagir no servidor** e está na posição **${posicao}** ` +
    'da fila.\n' +
    'A ordem da fila é pela sua interação aqui, seja com mensagens e/ou tempo em call, então parado você ' +
    'não sobe.\n\n' +
    '**Responda aqui neste ticket dizendo se ainda tem interesse em entrar na guilda.** Só a ' +
    'mensagem aqui tira você desta lista. Se não houver resposta, vou chamar o responsável pelo ' +
    'seu ticket amanhã.\n\n' +
    `⏳ **You have been inactive for ${dias} days** and you are number **${posicao}** in the ` +
    'queue.\n' +
    'The order is based on your interaction here, messages and voice time, so you do not move ' +
    'up while inactive.\n\n' +
    '**Reply here in this ticket telling us if you are still interested in joining the guild.** ' +
    'Only a message here takes you off this list. If there is no reply, I will ping the staff ' +
    'member responsible for your ticket tomorrow.'
  );
}

export function textoParaOResponsavel(ticket, parado) {
  const quem = ticket.responsavel_discord_id ? `<@${ticket.responsavel_discord_id}>` : '';

  // "Última interação" e não "está parado há": ele pode ter voltado a falar em outros canais sem
  // responder aqui, e é a falta de resposta no ticket que gerou este ping.
  const ultima = parado === null
    ? 'Sem leitura de atividade.'
    : `Última interação no servidor: há ${Math.floor(parado)} dias.`;

  return (
    `${quem}\n\n` +
    `⚠️ <@${ticket.opener_discord_id}> foi avisado ontem que estava parado e **não respondeu no ` +
    `ticket**.\n${ultima}\n\n` +
    'Vale conferir se ainda tem interesse na vaga.'
  );
}

/** Resumo para a staff. Sem ping: é registro, e quem precisava ser chamado já foi, no ticket. */
async function resumirParaStaff(client, avisados, escalados) {
  if (!config.channelId) return;
  if (!avisados.length && !escalados.length) return;

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[TICKET INATIVIDADE] canal ${config.channelId} não encontrado - resumo pulado`);
    return;
  }

  const linhas = (itens, formatar) => {
    const texto = itens.slice(0, MAX_LINHAS).map(formatar);
    const sobraram = itens.length - texto.length;
    if (sobraram > 0) texto.push(`… e mais ${sobraram}`);
    return texto.join('\n');
  };

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('⏳ Fila por tickets — inatividade')
    .setDescription(
      `Quem está da posição **${config.posicaoMinima}** para trás e passou de ` +
      `**${config.diasParado} dias** sem mensagem nem call.`
    )
    .setTimestamp();

  if (avisados.length) {
    embed.addFields({
      name: `🔔 Avisados no ticket (${avisados.length})`,
      value: linhas(avisados, a =>
        `<#${a.canalId}> · <@${a.openerId}> — ${Math.floor(a.parado)} dias · posição ${a.posicao}`
      ),
    });
  }

  if (escalados.length) {
    embed.addFields({
      name: `⚠️ Sem resposta, responsável chamado (${escalados.length})`,
      value: linhas(escalados, e =>
        `<#${e.canalId}> · <@${e.openerId}> — ` +
        `${e.parado === null ? 'sem leitura' : `${Math.floor(e.parado)} dias`} · ` +
        `posição ${e.posicao} · ` +
        (e.responsavelId ? `responsável <@${e.responsavelId}>` : '**sem responsável**')
      ),
    });
  }

  await canal.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(err => {
    console.warn(`[TICKET INATIVIDADE] falha ao postar o resumo: ${err.message}`);
  });
}

/** Roda a régua e devolve o que foi feito. */
export async function cobrarInativosDaFila(client) {
  const guild = client.guilds.cache.get(discordConfig.guildId);
  if (!guild) throw new Error('Guild não encontrada');

  const tickets = await getTicketsAbertos();
  if (!tickets.length) return { avisados: [], escalados: [] };

  // Sem as colunas de carimbo a régua não tem memória: o aviso sairia, a gravação falharia, e a
  // mesma pessoa levaria o mesmo ping todo dia às 10h. Melhor não começar. `getTicketsAbertos`
  // traz a linha inteira, então a checagem não custa consulta nenhuma.
  if (!('aviso_inatividade_em' in tickets[0])) {
    console.error(
      '[TICKET INATIVIDADE] ticket_queue não tem as colunas aviso_inatividade_em e ' +
      'aviso_inatividade_staff_em (timestamptz) — rodada cancelada.'
    );
    return { avisados: [], escalados: [], motivo: 'SEM_COLUNAS' };
  }

  const atividades = await getUltimaAtividade(tickets.map(t => t.opener_discord_id));

  // Quem saiu do servidor não é cobrado: perguntar "ainda tem interesse?" para quem não está mais
  // aqui não tem resposta possível, e o caso dele já tem aviso próprio, do
  // [ticketOrfaos.js](./ticketOrfaos.js), na mesma rodada das 07:00. `null` = não deu para
  // conferir, e aí ninguém é poupado nem acusado por falta de leitura — a régua roda como antes.
  const presentes = await getMembrosPresentes(guild, tickets.map(t => t.opener_discord_id));

  const avisados = [];
  const escalados = [];

  for (const [indice, ticket] of tickets.entries()) {
    if (presentes && !presentes.has(ticket.opener_discord_id)) continue;

    const posicao = indice + 1;
    const ultimaAtividade = atividades.get(ticket.opener_discord_id) ?? null;
    const { acao, parado } = decidirAcao(ticket, { posicao, ultimaAtividade });

    if (!acao) continue;

    const canal = guild.channels.cache.get(ticket.channel_id);
    if (!canal) continue;

    const conteudo = acao === 'avisar'
      ? textoParaOMembro(ticket.opener_discord_id, posicao, parado)
      : textoParaOResponsavel(ticket, parado);

    const alvo = acao === 'avisar' ? ticket.opener_discord_id : ticket.responsavel_discord_id;

    const enviado = await canal.send({
      content: conteudo,
      allowedMentions: alvo ? { users: [alvo] } : { parse: [] },
    }).then(() => true).catch(err => {
      console.warn(`[TICKET INATIVIDADE] falha ao avisar em ${canal.name}: ${err.message}`);
      return false;
    });

    // Carimba só depois de a mensagem entrar: falhar aqui tem que repetir amanhã, não pular a
    // etapa em silêncio e deixar a pessoa sem nunca ter sido avisada.
    if (!enviado) continue;

    const campo = acao === 'avisar' ? 'aviso_inatividade_em' : 'aviso_inatividade_staff_em';

    await atualizarTicket(ticket.channel_id, { [campo]: new Date().toISOString() })
      .catch(err => console.error(`[TICKET INATIVIDADE] falha ao carimbar ${ticket.channel_id}: ${err.message}`));

    const registro = {
      canalId: ticket.channel_id,
      openerId: ticket.opener_discord_id,
      responsavelId: ticket.responsavel_discord_id,
      posicao,
      parado,
    };

    if (acao === 'avisar') avisados.push(registro);
    else escalados.push(registro);
  }

  await resumirParaStaff(client, avisados, escalados);

  console.log(`[TICKET INATIVIDADE] ${avisados.length} avisado(s), ${escalados.length} escalado(s)`);

  return { avisados, escalados };
}
