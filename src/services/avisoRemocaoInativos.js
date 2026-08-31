import { EmbedBuilder } from 'discord.js';
import { getInactivePlayers, getLastWednesdayReference } from '../db.js';
import { getTentativasDeAviso } from '../inactivity.js';
import { CONTRIBUICAO_MINIMA } from './weeklyInactiveService.js';
import { inactivePlayers as config } from '../../config/index.js';

/**
 * Chamada da staff, domingo 06:00 — quem continua na lista de inativos depois de uma semana de
 * lembretes, com quantas vezes o bot já tentou falar com cada um.
 *
 * O lembrete de 3h cobra o membro; este aviso cobra a **staff**. Ele existe porque a decisão de
 * tirar alguém da guilda é de gente, não do bot: o que sai daqui é uma lista com a história de
 * cada caso para alguém olhar antes de puxar o gatilho — e domingo, não quarta, porque a semana
 * ainda não fechou e conversar com o membro nesses três dias ainda pode salvar a vaga dele.
 *
 * Quem já se resolveu não aparece: `liberarQuemContribuiu()`
 * ([inactivePlayers.js](./inactivePlayers.js)) roda a cada ciclo de 3h e tira da lista quem bateu
 * o mínimo, então às 06:00 de domingo a lista está no máximo 3h desatualizada. Não vale a pena
 * refazer a conta de contribuição aqui só por isso.
 */

/** Teto de linhas do aviso. Lista cortada tem que dizer que foi cortada. */
const MAX_LINHAS = 25;

/**
 * Ordena pelo caso mais gritante primeiro: mais tentativas ignoradas na frente, e empate
 * desempatado por quem está na lista há mais tempo. É a ordem em que a staff quer decidir.
 */
export function ordenarPorTentativas(linhas) {
  return [...linhas].sort((a, b) =>
    b.tentativas - a.tentativas || String(a.desdeQuando).localeCompare(String(b.desdeQuando))
  );
}

/** Junta a lista de inativos com os contadores de tentativa. */
export async function montarListaDeRemocao() {
  const naLista = await getInactivePlayers();
  if (!naLista.length) return { linhas: [], contadoresDisponiveis: true };

  // `null` = sem as colunas de contador. O aviso ainda vale: a lista de quem não respondeu é o
  // essencial, o número de tentativas é o detalhe.
  const contadores = await getTentativasDeAviso(getLastWednesdayReference());
  const tentativas = contadores ?? new Map();
  const contadoresDisponiveis = contadores !== null;

  const linhas = naLista.map(player => {
    const contador = tentativas.get(String(player.brawlhalla_id));

    return {
      discordId: String(player.discord_id),
      brawlhallaId: String(player.brawlhalla_id),
      desdeQuando: contador?.created_at || player.created_at,
      tentativas: contador?.avisos_enviados ?? 0,
      dmsFalhadas: contador?.dms_falhadas ?? 0,
    };
  });

  return { linhas: ordenarPorTentativas(linhas), contadoresDisponiveis };
}

/**
 * Nunca alcançado por DM em nenhuma das tentativas. É a diferença entre ignorar o aviso e nunca
 * ter recebido um — e a segunda não é motivo para tirar ninguém da guilda sem falar antes.
 */
function nuncaRecebeuDm(linha) {
  return linha.tentativas > 0 && linha.dmsFalhadas >= linha.tentativas;
}

/** Pura de propósito: dá para conferir o texto sem banco nem Discord. */
export function montarEmbed(linhas, contadoresDisponiveis) {
  const texto = linhas.slice(0, MAX_LINHAS).map(linha => {
    const vezes = linha.tentativas === 1 ? 'aviso' : 'avisos';
    const contagem = contadoresDisponiveis ? ` — **${linha.tentativas}** ${vezes}` : '';
    const marca = nuncaRecebeuDm(linha) ? ' · 📪 nunca recebeu DM' : '';

    return `<@${linha.discordId}>${contagem}${marca}`;
  });

  const sobraram = linhas.length - texto.length;
  if (sobraram > 0) texto.push(`… e mais ${sobraram}`);

  const rodape = linhas.some(nuncaRecebeuDm)
    ? '📪 = o bot nunca conseguiu mandar DM. Antes de remover, vale chamar no privado.'
    : `Sai da lista sozinho quem bater os ${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')} de contribuição na semana.`;

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🚪 Inativos sem resposta')
    .setDescription(
      `Estes **${linhas.length}** membros continuam na lista de inativos e não responderam aos ` +
      'avisos do bot. Deem uma olhada em cada um, ou puxem conversa com quem valer a pena ' +
      'segurar. Os que sobrarem podem ser removidos da guilda.\n\n' +
      texto.join('\n')
    )
    .setFooter({ text: rodape })
    .setTimestamp();
}

/** Posta o aviso no canal dos inativos, pingando só o cargo. */
export async function avisarRemocaoDeInativos(client) {
  const { channelId, removalNotice } = config;

  if (!channelId) {
    console.log('[Remocao Inativos] canal dos inativos não configurado — aviso pulado');
    return { anunciado: false, motivo: 'SEM_CANAL' };
  }

  const { linhas, contadoresDisponiveis } = await montarListaDeRemocao();

  if (!linhas.length) {
    console.log('[Remocao Inativos] ninguém na lista — nada a avisar');
    return { anunciado: false, motivo: 'LISTA_VAZIA' };
  }

  const canal = await client.channels.fetch(channelId).catch(() => null);

  if (!canal) {
    console.warn(`[Remocao Inativos] canal ${channelId} não encontrado — aviso pulado`);
    return { anunciado: false, motivo: 'CANAL_NAO_ENCONTRADO' };
  }

  const cargo = removalNotice?.officerRoleId;

  // Ping só no cargo: quem está listado já leva ping a cada 3h, e esta mensagem é sobre eles,
  // não para eles.
  await canal.send({
    content: cargo ? `<@&${cargo}>` : undefined,
    embeds: [montarEmbed(linhas, contadoresDisponiveis)],
    allowedMentions: cargo ? { roles: [cargo] } : { parse: [] },
  });

  console.log(`[Remocao Inativos] ${linhas.length} sem resposta avisados à staff`);

  return { anunciado: true, total: linhas.length };
}
