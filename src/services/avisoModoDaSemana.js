import { getWeeklyMissions } from '../db.js';
import { missoesDaSemana, semanaVigente } from './weeklyMissionsService.js';
import { calcularQuemFalta } from './contributionReminderService.js';
import { CONTRIBUICAO_MINIMA } from './weeklyInactiveService.js';
import { createWarningEmbed } from '../../utils/discordUtils.js';
import { avisoModoDaSemana as config, runtime } from '../../config/index.js';

/**
 * Aviso no procurando-jogo: alguém chama 2v2 na semana de 3v3 (ou o contrário) e o bot lembra
 * qual é a missão da semana.
 *
 * O bloco de ranked alterna entre `ranked-2v2` e `ranked-3v3` toda semana, então metade do tempo
 * a partida que a pessoa está chamando não avança missão nenhuma — e quem está abaixo do mínimo
 * é justamente quem não pode gastar a noite no modo errado.
 *
 * **A conferência é contra as quatro missões da semana, não contra o bloco que alterna.** A
 * posição 1 do ciclo passa por `ouro-2v2`, `platina-2v2` e `diamante-2v2`: numa semana dessas o
 * 2v2 conta mesmo com a ranked sendo 3v3, e cobrar ali seria dar informação errada.
 *
 * Quem é avisado é exatamente quem o lembrete de domingo avisaria — `calcularQuemFalta()`, que já
 * carrega as isenções de staff, blindado, recém-chegado e sem medição. Repetir a regra aqui faria
 * o canal cobrar quem a quarta-feira não vai cobrar.
 */

/** Os dois modos que se alternam. 1v1 fica de fora: não é o bloco que alterna. */
const MODOS = ['2v2', '3v3'];

/**
 * `2v2`, `2vs2`, `2x2`, `2 v 2`. O lookbehind e o lookahead impedem que placar (`12v2`) ou
 * número solto vire menção de modo.
 */
const PADRAO_MODO = /(?<!\d)([23])\s*(?:vs?|x)\s*\1(?!\d)/gi;

/** Quanto tempo sem avisar a mesma pessoa de novo. */
const COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Validade dos dois caches em memória. Sem eles, cada "bora 2v2?" no canal seria uma consulta ao
 * Supabase e uma leitura da guilda inteira na API — a lista de quem falta é a guilda toda, não a
 * pessoa que escreveu.
 *
 * Os prazos são diferentes porque as duas coisas mudam em ritmos diferentes: missão muda uma vez
 * por semana (o prazo aqui só existe para pegar correção da staff no mesmo dia), e contribuição
 * muda a cada partida — 5 min é o mesmo TTL do cache da API do Brawlhalla, então prazo menor não
 * traria número mais novo.
 */
const TTL_MISSOES_MS = 10 * 60 * 1000;
const TTL_CONTRIBUICAO_MS = 5 * 60 * 1000;

const ultimoAviso = new Map();

let cacheMissoes = { expiraEm: 0, promessa: null };
let cacheFaltando = { expiraEm: 0, promessa: null };

/** Os modos de ranked citados num texto qualquer — serve para a mensagem e para a missão. */
export function modosCitados(texto) {
  const encontrados = new Set();

  for (const [, numero] of String(texto || '').matchAll(PADRAO_MODO)) {
    encontrados.add(`${numero}v${numero}`);
  }

  return encontrados;
}

/**
 * As missões **ainda abertas** da semana que envolvem cada modo, lidas do texto da missão.
 *
 * Missão concluída sai da conta porque depois dela o modo não rende mais nada — o que sobra é
 * guild battle, que não depende de ninguém trocar de fila. Isso vale para os dois lados: some o
 * motivo de avisar quando a missão do modo certo já fechou, e volta o motivo de avisar quando é a
 * do modo citado que fechou (a semana de `ouro-2v2` concluída com a ranked 3v3 aberta).
 *
 * A fonte é o cadastro (`weekly_missions`), não o ciclo: a staff corrige divergência e marca
 * `.missao-done` pelo bot, e o aviso tem que seguir os dois. Semana ainda não cadastrada cai na
 * previsão do ciclo, onde nada está concluído — que é verdade, já que ninguém marcou nada.
 */
export function agruparMissoesPorModo(missoes) {
  const porModo = new Map(MODOS.map(m => [m, []]));

  for (const missao of missoes) {
    if (missao.status === 'done') continue;

    for (const modo of modosCitados(missao.mission)) {
      porModo.get(modo)?.push(missao.mission);
    }
  }

  return porModo;
}

async function missoesPorModo() {
  const agora = Date.now();

  if (!cacheMissoes.promessa || agora >= cacheMissoes.expiraEm) {
    cacheMissoes = {
      expiraEm: agora + TTL_MISSOES_MS,
      promessa: (async () => {
        const cadastradas = await getWeeklyMissions();
        const missoes = cadastradas.length ? cadastradas : missoesDaSemana(semanaVigente());
        return agruparMissoesPorModo(missoes);
      })().catch(err => {
        cacheMissoes.expiraEm = 0;
        throw err;
      }),
    };
  }

  return cacheMissoes.promessa;
}

function quemFalta() {
  const agora = Date.now();

  if (!cacheFaltando.promessa || agora >= cacheFaltando.expiraEm) {
    cacheFaltando = {
      expiraEm: agora + TTL_CONTRIBUICAO_MS,
      promessa: calcularQuemFalta().catch(err => {
        cacheFaltando.expiraEm = 0;
        throw err;
      }),
    };
  }

  return cacheFaltando.promessa;
}

/**
 * Decide se o texto pede aviso. Função pura — dá para conferir qualquer frase sem tocar no banco.
 *
 * Citar os dois modos não é erro: quem escreve "bora 3v3, ou 2v2 se faltar gente" numa semana de
 * 3v3 já sabe qual é a missão, e avisar seria corrigir quem está certo.
 *
 * `porModo` só traz missão aberta, então "nenhum dos dois modos tem missão" cobre tanto a semana
 * sem ranked quanto a semana em que ela já foi concluída — nos dois casos não há para onde mandar
 * a pessoa ir.
 */
export function avaliarTexto(texto, porModo) {
  const citados = modosCitados(texto);

  if (!citados.size) return null;

  const daSemana = MODOS.filter(m => porModo.get(m)?.length);

  if (!daSemana.length) return null;
  if (daSemana.some(m => citados.has(m))) return null;

  const modoErrado = [...citados].find(m => MODOS.includes(m));

  if (!modoErrado) return null;

  return { modoErrado, modoCerto: daSemana[0], missoes: porModo.get(daSemana[0]) };
}

/** Payload do aviso. Exportado para dar pra conferir sem enviar nada. */
export function montarAviso(pessoa, { modoErrado, modoCerto, missoes }) {
  const falta = Math.max(0, CONTRIBUICAO_MINIMA - pessoa.contribuicao);
  const lista = missoes.map(m => `**${m}**`).join(' e ');

  const embed = createWarningEmbed(
    `Esta semana a missão é ${modoCerto}, não ${modoErrado}`,
    `Nenhuma das missões desta semana envolve **${modoErrado}**, então partida de ${modoErrado} ` +
    `não vira contribuição. O que conta é ${lista}.\n\n` +
    `Você está com **${pessoa.contribuicao.toLocaleString('pt-BR')}** de ` +
    `**${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')}** de contribuição — faltam ` +
    `**${falta.toLocaleString('pt-BR')}** para não ser marcado como inativo na quarta.\n\n` +
    `Chame a galera pro ${modoCerto} e use \`.missoes\` para ver a semana inteira.`
  );

  return { embeds: [embed], allowedMentions: { repliedUser: true } };
}

/**
 * Olha uma mensagem do procurando-jogo e avisa se for chamada para o modo errado.
 *
 * Chamada em `messageCreate` para toda mensagem do canal, então a ordem é do mais barato para o
 * mais caro: canal, cooldown e regex resolvem em memória, e só o que sobra consulta banco e API.
 * Falha aqui não pode atrapalhar mensagem nenhuma — o erro é logado e engolido.
 */
export async function avisarModoDaSemana(message) {
  try {
    if (!config.channelId || message.channelId !== config.channelId) return null;
    if (message.author.bot) return null;

    const agora = Date.now();
    const ultimo = ultimoAviso.get(message.author.id);

    if (ultimo && agora - ultimo < COOLDOWN_MS) return null;

    const citados = modosCitados(message.content);

    if (!citados.size) return null;

    const aviso = avaliarTexto(message.content, await missoesPorModo());

    if (!aviso) return null;

    const { faltando } = await quemFalta();
    const pessoa = faltando.find(p => p.discordId === message.author.id);

    // Não está na lista: é staff, está blindado, entrou nesta semana, não pôde ser medido ou já
    // bateu o mínimo. Nenhum desses precisa ser cobrado.
    if (!pessoa) return null;

    ultimoAviso.set(message.author.id, agora);

    const payload = montarAviso(pessoa, aviso);

    if (runtime.isDev) {
      console.log(
        `[MODO] dev: avisaria ${pessoa.nome} (${message.author.id}) - citou ${aviso.modoErrado}, ` +
        `semana é ${aviso.modoCerto}, contribuição ${pessoa.contribuicao}`
      );
      return { ...aviso, enviado: false };
    }

    await message.reply(payload);

    console.log(
      `[MODO] avisado ${pessoa.nome} (${message.author.id}) - citou ${aviso.modoErrado}, ` +
      `semana é ${aviso.modoCerto}, contribuição ${pessoa.contribuicao}`
    );

    return { ...aviso, enviado: true };

  } catch (err) {
    console.warn('[MODO] falha ao avaliar mensagem do procurando-jogo:', err.message);
    return null;
  }
}
