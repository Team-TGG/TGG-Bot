import { EmbedBuilder } from 'discord.js';
import { getWeeklyMissions, getMissionWeekStart } from '../db.js';
import { getAchievementsByWeekStart, insertWeeklyAchievements } from '../tggCoins.js';
import { missoesDaSemana, semanaVigente } from './weeklyMissionsService.js';
import { weeklyAchievements as config } from '../../config/index.js';

/**
 * Cadastro automático das conquistas do `.conquistas`, na quinta 06:00, logo depois das missões.
 *
 * As conquistas são a tradução das missões da semana em recompensa individual: a guilda pontua
 * pela missão, o membro ganha TGG Coins por chegar nos tiers. Por isso o que a semana pede sai das
 * missões dela, e não de um ciclo próprio — dois calendários paralelos divergiriam na primeira
 * semana de correção, e o membro veria conquista de 3v3 numa semana de 2v2.
 */

/** Contribuição: as três existem toda semana. Não dependem de missão nenhuma. */
const CONTRIBUICAO = [
  { target: 1000, reward: 10 },
  { target: 5000, reward: 40 },
  { target: 10000, reward: 50 },
];

/** Partidas no modo ranked que a semana pede — os quatro tiers andam juntos. */
const GAMES = [
  { target: 10, reward: 10 },
  { target: 25, reward: 15 },
  { target: 50, reward: 25 },
  { target: 100, reward: 50 },
];

/** Elo é tudo ou nada: um tier só, e a maior recompensa da semana. */
const RECOMPENSA_ELO = 100;

/**
 * O elo que cada patamar exige. São os mesmos cortes de `ELO_ROLES` em [discord.js](../discord.js)
 * (Gold 1 = 1390, Platinum 1 = 1680, Diamond = 2000), e os mesmos que a staff vinha cadastrando à
 * mão. O nome do patamar vem da missão; o número tem que sair daqui, porque a missão fala em guild
 * points e a conquista, em elo.
 */
const ELO_POR_PATAMAR = { ouro: 1390, platina: 1680, diamante: 2000 };

/**
 * `Ranked 2v2 com membro da guilda` → `2v2`. É essa missão, e não o ciclo, que decide o modo das
 * conquistas de partidas: a posição alterna entre 2v2 e 3v3 toda semana.
 */
const PADRAO_RANKED_GUILDA = /ranked\s*([23])\s*v\s*\1\b.*guilda/i;

/** `Pegue ouro na Ranked 1v1` → patamar + modo. Semana de PVE ou BOTW não casa, e nem deve. */
const PADRAO_ELO = /(ouro|platina|diamante).*?([123])\s*v\s*\2\b/i;

function numeroBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

/**
 * As conquistas de uma semana, a partir das missões dela. Função pura — dá para conferir qualquer
 * semana sem tocar no banco.
 *
 * Os modos saem do **texto** da missão por regex, e não de uma tabela de-para: a staff corrige o
 * cadastro pelo site e o texto corrigido continua sendo entendido. Missão que não casa com padrão
 * nenhum não gera conquista — inventar uma a partir do ciclo faria o membro perseguir um alvo que
 * a semana não pede.
 */
export function conquistasDaSemana(missoes) {
  const linhas = CONTRIBUICAO.map(({ target, reward }) => ({
    mode: 'Guilda',
    description: `Consiga ${numeroBR(target)} de contribuição`,
    type: 'CONTRIBUICAO',
    target,
    reward,
  }));

  const textos = (missoes ?? []).map((m) => String(m?.mission || ''));

  const ranked = textos.map((t) => t.match(PADRAO_RANKED_GUILDA)).find(Boolean);

  if (ranked) {
    const mode = `Ranked ${ranked[1]}v${ranked[1]}`;

    linhas.push(...GAMES.map(({ target, reward }) => ({
      mode,
      description: `Jogue ${target} jogos`,
      type: 'GAMES',
      target,
      reward,
    })));
  }

  const elo = textos.map((t) => t.match(PADRAO_ELO)).find(Boolean);

  if (elo) {
    const patamar = elo[1].toLowerCase();
    const mode = `Ranked ${elo[2]}v${elo[2]}`;

    linhas.push({
      mode,
      description: `Alcance ${patamar} na ${mode}`,
      type: 'ELO',
      target: ELO_POR_PATAMAR[patamar],
      reward: RECOMPENSA_ELO,
    });
  }

  return linhas;
}

const ICONE = { CONTRIBUICAO: '🛡️', GAMES: '🎮', ELO: '🏆', WINS: '🥇' };

const ROTULO = {
  CONTRIBUICAO: 'Contribuição',
  GAMES: 'Partidas',
  ELO: 'Elo',
  WINS: 'Vitórias',
};

/**
 * O aviso da staff, em log-guilda. Exportado para dar pra conferir sem enviar nada.
 *
 * Um campo por grupo de modo+tipo, que é como o `.conquistas` agrupa. `faltando` sai dito em voz
 * alta: conquista de partidas existe toda semana, então não ter uma é sinal de que a missão de
 * ranked não foi reconhecida — e sem o aviso ninguém descobre até alguém reclamar que a semana
 * veio sem conquista.
 */
export function montarAviso(weekStart, linhas, faltando = []) {
  const [ano, mes, dia] = String(weekStart).slice(0, 10).split('-');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🏅 Conquistas da semana')
    .setDescription(`Semana de **${dia}/${mes}/${ano}** - cadastradas a partir das missões, valem até quarta-feira às 06:00.`)
    .setTimestamp();

  const grupos = new Map();

  for (const linha of linhas) {
    const chave = `${linha.mode}_${linha.type}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(linha);
  }

  for (const [, tiers] of grupos) {
    const { mode, type } = tiers[0];

    embed.addFields({
      name: `${ICONE[type] ?? '📌'} ${ROTULO[type] ?? type} - ${mode}`,
      value: tiers
        .map((t) => `🎯 **${numeroBR(t.target)}** → ${numeroBR(t.reward)} TGG Coins`)
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  for (const aviso of faltando) {
    embed.addFields({ name: '⚠️ Não cadastrada', value: aviso.slice(0, 1024), inline: false });
  }

  const payload = {
    embeds: [embed],
    // parse vazio garante que o aviso nunca notifica ninguém
    allowedMentions: { parse: [] },
  };

  if (config.correcaoUrl) {
    payload.content = `Encontrou alguma divergência? Corrija em ${config.correcaoUrl}`;
  }

  return payload;
}

async function avisar(client, payload) {
  if (!config.channelId) {
    console.warn('[CONQUISTAS] canal de aviso não configurado - envio pulado');
    return false;
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[CONQUISTAS] canal ${config.channelId} não encontrado - envio pulado`);
    return false;
  }

  await canal.send(payload);
  return true;
}

/**
 * Cadastra as conquistas da semana vigente e avisa a staff.
 *
 * Não sobrescreve: semana que já tem conquista (cadastro manual pelo site, ou uma segunda execução)
 * fica como está. É o que torna a rotina repetível — ao contrário do cargo de MVP, conquista
 * duplicada vira pagamento duplicado.
 *
 * A fonte é o cadastro (`weekly_missions`), com a previsão do ciclo como plano B, igual ao aviso de
 * modo do procurando-jogo: correção da staff tem que valer aqui também. O plano B existe porque as
 * missões e as conquistas nascem no mesmo minuto — se o cadastro delas falhar, as conquistas ainda
 * saem certas pelo ciclo.
 */
export async function registrarConquistasDaSemana(client) {
  const weekStart = getMissionWeekStart();

  try {
    const existentes = await getAchievementsByWeekStart(weekStart);

    if (existentes.length) {
      console.log(`[CONQUISTAS] semana ${weekStart} já tem ${existentes.length} conquista(s) - nada a fazer`);
      return { criadas: 0, weekStart, aviso: false };
    }

    const cadastradas = await getWeeklyMissions();
    const missoes = cadastradas.length ? cadastradas : missoesDaSemana(semanaVigente());
    const linhas = conquistasDaSemana(missoes);

    const faltando = [];

    if (!linhas.some((l) => l.type === 'GAMES')) {
      faltando.push(
        'Nenhuma missão de **ranked com a guilda** foi reconhecida nesta semana, então as quatro '
        + 'conquistas de partidas não entraram. Cadastre à mão se a semana tiver uma.'
      );
    }

    await insertWeeklyAchievements(weekStart, linhas);

    console.log(`[CONQUISTAS] semana ${weekStart} cadastrada com ${linhas.length} conquista(s):`);
    linhas.forEach((l) => console.log(`  ${l.type} ${l.mode} - alvo ${l.target}, recompensa ${l.reward}`));

    const aviso = await avisar(client, montarAviso(weekStart, linhas, faltando)).catch((err) => {
      console.error('[CONQUISTAS] falha ao avisar a staff:', err.message);
      return false;
    });

    return { criadas: linhas.length, weekStart, aviso };

  } catch (err) {
    console.error('[CONQUISTAS] falha ao cadastrar a semana', weekStart, err);
    throw err;
  }
}
