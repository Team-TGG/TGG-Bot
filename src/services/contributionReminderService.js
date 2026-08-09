import { EmbedBuilder } from 'discord.js';
import pLimit from 'p-limit';
import { getWeeklyMissions, getMissionWeekEnd, getCurrentInactivityWeekReference } from '../db.js';
import { calcularContribuicaoSemanal } from './contribuicaoSemanal.js';
import { selecionarInativos, CONTRIBUICAO_MINIMA } from './weeklyInactiveService.js';
import { getBlindadosNaSemana } from '../inactivity.js';
import { contributionReminder as config } from '../../config/index.js';

/**
 * Lembrete de domingo 12:00 — avisa quem ainda não bateu a contribuição mínima da semana.
 *
 * A semana só fecha na quarta 06:00, então domingo ainda dá três dias para correr atrás. O
 * público é exatamente quem seria inativado se a semana fechasse agora: mesma conta, mesmas
 * isenções (staff, blindado, recém-chegado, sem medição) de
 * [weeklyInactiveService.js](./weeklyInactiveService.js).
 *
 * Diferença de uma coisa só: quem já está na lista de inativos da semana passada continua sendo
 * avisado. Lá isso é motivo de pular (a linha já existe); aqui é justamente quem mais precisa do
 * empurrão.
 */

/**
 * Discord corta mensagem em 2.000 caracteres e aceita no máximo 100 usuários em
 * `allowedMentions`. Com ~100 pessoas na lista, os dois tetos são atingidos — daí o lote.
 */
const MENCOES_POR_MENSAGEM = 80;
const LIMITE_DE_CARACTERES = 1900;

/** Quem ainda não bateu o mínimo nesta semana. */
export async function calcularQuemFalta() {
  const weekReference = getCurrentInactivityWeekReference();

  const [{ weekStart, linhas }, blindados] = await Promise.all([
    calcularContribuicaoSemanal(),
    getBlindadosNaSemana(weekReference),
  ]);

  // jaNaLista vazio de propósito: estar na lista da semana passada não tira ninguém do lembrete
  const { inativos, poupados } = selecionarInativos({ linhas, blindados, jaNaLista: new Set() });

  return { weekStart, weekReference, faltando: inativos, poupados };
}

/** Quebra as menções em lotes que cabem nos dois limites do Discord. */
export function lotesDeMencoes(ids) {
  const lotes = [];
  let atual = [];

  for (const id of ids) {
    const cabeEmCaracteres = (atual.length + 1) * `<@${id}> `.length <= LIMITE_DE_CARACTERES;

    if (atual.length >= MENCOES_POR_MENSAGEM || !cabeEmCaracteres) {
      lotes.push(atual);
      atual = [];
    }

    atual.push(id);
  }

  if (atual.length) lotes.push(atual);

  return lotes;
}

/** As missões da semana que ainda não foram marcadas como concluídas. */
function textoDasMissoes(missoes) {
  const abertas = missoes.filter(m => m.status !== 'done');

  if (!missoes.length) {
    return 'As missões desta semana ainda não foram cadastradas — fique de olho em `.missoes`.';
  }

  if (!abertas.length) {
    return '✅ Todas as missões da semana já foram concluídas pela guilda. Contribua nas partidas ranqueadas e nos modos da guilda.';
  }

  return abertas
    .map(m => `🎯 **${m.mission}**\n┗ Objetivo: ${Number(m.target).toLocaleString('pt-BR')} pontos\n┗ _${m.tip}_`)
    .join('\n\n');
}

function prazo() {
  const fim = new Date(getMissionWeekEnd());
  const epoch = Math.floor(fim.getTime() / 1000);

  // Timestamp do Discord: cada um vê no próprio fuso, e o relativo já conta os dias
  return { absoluto: `<t:${epoch}:F>`, relativo: `<t:${epoch}:R>` };
}

/** Embed do canal. Exportado para dar pra conferir sem enviar nada. */
export function montarEmbedDoCanal(quantidade, missoes) {
  const { absoluto, relativo } = prazo();

  return new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('⏳ Ainda dá tempo de bater a contribuição da semana')
    .setDescription(
      `Quem está marcado abaixo ainda não chegou aos **${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')} ` +
      `de contribuição** desta semana e pode ser marcado como inativo quando ela fechar.\n\n` +
      `⌛ A semana fecha ${absoluto} (${relativo}).\n` +
      `📊 Veja quanto falta para você em \`.stats\`.`
    )
    .addFields(
      { name: 'Missões ainda abertas', value: textoDasMissoes(missoes).slice(0, 1024), inline: false },
      {
        name: 'Não vai conseguir jogar?',
        value: 'Use `.justificativa <motivo> <semanas>` e a staff avalia. Pedido sem resposta **não** protege ninguém, então mande com antecedência.',
        inline: false,
      },
    )
    .setFooter({ text: `${quantidade} membro(s) ainda não bateram a meta` })
    .setTimestamp();
}

/** DM personalizada: mostra o quanto a pessoa já fez e o quanto falta. */
export function montarDm(pessoa, missoes) {
  const { absoluto, relativo } = prazo();
  const falta = Math.max(0, CONTRIBUICAO_MINIMA - pessoa.contribuicao);

  return new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('⏳ Faltam pontos para sua contribuição da semana')
    .setDescription(
      `Você está com **${pessoa.contribuicao.toLocaleString('pt-BR')}** de ` +
      `**${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')}** de contribuição nesta semana — ` +
      `faltam **${falta.toLocaleString('pt-BR')}**.\n\n` +
      `⌛ Você tem até ${absoluto} (${relativo}). Quem não bater a meta é marcado como inativo.`
    )
    .addFields(
      { name: 'Missões ainda abertas', value: textoDasMissoes(missoes).slice(0, 1024), inline: false },
      {
        name: 'Não vai conseguir jogar?',
        value: 'Use `.justificativa <motivo> <semanas>` no servidor e a staff avalia.',
        inline: false,
      },
    )
    .setTimestamp();
}

async function avisarNoCanal(client, faltando, missoes) {
  if (!config.channelId) {
    console.warn('[LEMBRETE] channelId não configurado — aviso pulado');
    return 0;
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[LEMBRETE] canal ${config.channelId} não encontrado — aviso pulado`);
    return 0;
  }

  // O embed vai sozinho na frente; as menções vêm depois, em lotes, para não estourar os limites
  await canal.send({ embeds: [montarEmbedDoCanal(faltando.length, missoes)], allowedMentions: { parse: [] } });

  const lotes = lotesDeMencoes(faltando.map(p => p.discordId));

  for (const lote of lotes) {
    await canal.send({
      content: lote.map(id => `<@${id}>`).join(' '),
      allowedMentions: { users: lote },
    });
  }

  return lotes.length;
}

async function mandarDms(client, faltando, missoes) {
  const limit = pLimit(5);

  let entregues = 0;

  await Promise.all(faltando.map(pessoa => limit(async () => {
    const user = await client.users.fetch(pessoa.discordId).catch(() => null);

    if (!user) return;

    // DM fechada é comum e não é falha: o ping no canal ainda alcança a pessoa
    await user.send({ embeds: [montarDm(pessoa, missoes)] })
      .then(() => { entregues++; })
      .catch(() => console.log(`[LEMBRETE] DM bloqueada: ${pessoa.nome} (${pessoa.discordId})`));
  })));

  return entregues;
}

/**
 * Manda o lembrete de contribuição no canal e por DM.
 *
 * Roda domingo 12:00. Não grava nada — é só aviso, então repetir é inofensivo.
 */
export async function lembrarContribuicao(client) {
  try {
    const { weekStart, faltando } = await calcularQuemFalta();

    if (!faltando.length) {
      console.log(`[LEMBRETE] semana ${weekStart}: todo mundo já bateu a meta — nada a avisar`);
      return { avisados: 0, mensagens: 0, dms: 0 };
    }

    // Falha ao buscar missão não cancela o lembrete: o aviso do prazo já vale sozinho
    const missoes = await getWeeklyMissions().catch(err => {
      console.warn('[LEMBRETE] missões indisponíveis:', err.message);
      return [];
    });

    const mensagens = await avisarNoCanal(client, faltando, missoes).catch(err => {
      console.error('[LEMBRETE] falha ao avisar no canal:', err.message);
      return 0;
    });

    const dms = await mandarDms(client, faltando, missoes);

    console.log(`[LEMBRETE] semana ${weekStart}: ${faltando.length} avisados (${mensagens} mensagem(ns), ${dms} DM(s))`);

    return { avisados: faltando.length, mensagens, dms };

  } catch (err) {
    console.error('[LEMBRETE] falha ao mandar o lembrete de contribuição', err);
    throw err;
  }
}
