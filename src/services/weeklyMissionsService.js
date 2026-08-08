import { EmbedBuilder } from 'discord.js';
import { getMissionsByWeekStart, insertWeeklyMissions, getMissionWeekStart } from '../db.js';
import { weeklyMissions as config } from '../../config/index.js';

// Os textos abaixo espelham $missionTemplates de cadastro_missao.php, no repo do site
// (C:\xampp\htdocs\TGG). Se um alvo ou dica mudar lá, mude aqui também — as duas listas
// alimentam a mesma tabela e divergir faz a semana entrar com valor errado.
const TEMPLATES = {
  'horda-pesadelo': {
    mission: 'Alcance a onda 20 no modo Horda Pesadelo',
    tip: 'Esse modo vai ser muito divertido e vamos completar, basicamente é o modo horda mais difícil, criem um lobby com 4 pessoas e cheguem o mais longe possível, a quantidade de "ondas" (rodadas) vai aumentando a cada tier.',
    target: 16,
  },
  'horda': {
    mission: 'Alcance a onda 26 no modo Horda',
    tip: 'Esse modo vai ser muito divertido e vamos completar, criem um lobby com 4 pessoas e cheguem o mais longe possível, a quantidade de "ondas" (rodadas) vai aumentando a cada tier.',
    target: 16,
  },
  'walker-attack': {
    mission: 'Alcance a onda 16 no modo Walker Attack',
    tip: 'Quest bacana que envolve PVE, a cada tier vai aumentando um pouco mais a wave que temos que chegar, se junte com um amigo e chegue o mais longe que conseguir.',
    target: 16,
  },
  'ouro-1v1': {
    mission: 'Pegue ouro na Ranked 1v1',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no ouro, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'ouro-2v2': {
    mission: 'Pegue ouro na Ranked 2v2',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no ouro, GANHEM uma partida e a missão será contabilizada. ELO INDIVIDUAL, NÃO O DE TIME',
    target: 125,
  },
  'ouro-3v3': {
    mission: 'Pegue ouro na Ranked 3v3',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no ouro, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'platina-1v1': {
    mission: 'Pegue platina na Ranked 1v1',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no platina, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'platina-2v2': {
    mission: 'Pegue platina na Ranked 2v2',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no platina, GANHEM uma partida e a missão será contabilizada. ELO INDIVIDUAL, NÃO O DE TIME',
    target: 125,
  },
  'platina-3v3': {
    mission: 'Pegue platina na Ranked 3v3',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no platina, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'diamante-1v1': {
    mission: 'Pegue diamante na Ranked 1v1',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no diamante, GANHEM uma partida e a missão será contabilizada.',
    target: 100,
  },
  'diamante-2v2': {
    mission: 'Pegue diamante na Ranked 2v2',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no diamante, GANHEM uma partida e a missão será contabilizada. ELO INDIVIDUAL, NÃO O DE TIME',
    target: 100,
  },
  'diamante-3v3': {
    mission: 'Pegue diamante na Ranked 3v3',
    tip: 'NÃO FAÇAM ESSA QUEST',
    target: 100,
  },
  'botw': {
    mission: 'Vitórias no Brawl of the Week',
    tip: 'É necessário GANHAR.',
    target: 750,
  },
  'ranked-3v3': {
    mission: 'Ranked 3v3 com membro da guilda',
    tip: 'Não é necessário vencer, apenas jogar. O trio PRECISA ser composto por membros da guilda pra contabilizar',
    target: 2800,
  },
  'ranked-2v2': {
    mission: 'Ranked 2v2 com membro da guilda',
    tip: 'Não é necessário vencer, apenas jogar. Precisa jogar com um membro da guilda pra contabilizar',
    target: 3750,
  },
  'crew-battle': {
    mission: 'Jogos de Crew Battle',
    tip: 'Crie um lobby com o maior número de jogadores possível, coloque todos os jogadores em um time e APENAS UM em um outro time (7 jogadores no time azul e 1 no vermelho). Depois, só dar dano o suficiente pra contabilizar XP (aproximadamente 100 de dano) e deixe o jogador que está sozinho se matar 3 vezes.',
    target: 1000,
  },
  'brawlball': {
    mission: 'Jogos de Brawlball',
    tip: 'Crie um Lobby com o máximo de pessoas possível, apenas uma equipe faz o ponto, enquanto as outras dão dano uma na outra (acho que uns 80 de dano) para contar xp, ou seja, todo jogo tem que terminar 5 x 0.',
    target: 1000,
  },
  'kungfoot': {
    mission: 'Jogos de Kungfoot',
    tip: 'Crie um Lobby com o máximo de pessoas possível, apenas uma equipe faz o gol, enquanto as outras dão dano uma na outra (acho que uns 80 de dano) para contar xp, ou seja, todo jogo tem que terminar 5 x 0.',
    target: 1000,
  },
};

// Cada posição da semana tem seu próprio ciclo, de tamanho diferente. Como os
// tamanhos são 12, 1, 2 e 3, a combinação das quatro só se repete a cada 12 semanas.
const CICLOS = [
  [
    'horda-pesadelo', 'horda', 'walker-attack',
    'ouro-1v1', 'ouro-2v2', 'ouro-3v3',
    'platina-1v1', 'platina-2v2', 'platina-3v3',
    'diamante-1v1', 'diamante-2v2', 'diamante-3v3',
  ],
  ['botw'],
  ['ranked-3v3', 'ranked-2v2'],
  ['crew-battle', 'brawlball', 'kungfoot'],
];

// Primeira quinta do ciclo: nessa semana todos os quatro ciclos começam do índice 0.
const ANCORA = '2026-08-06';

const DIA = 86400000;

// % em JS devolve negativo para entrada negativa, o que quebraria semanas anteriores à âncora
const mod = (n, m) => ((n % m) + m) % m;

function paraUTC(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

/** Quantas semanas separam a data informada da âncora. Negativo antes dela. */
export function indiceDaSemana(weekStart) {
  return Math.round((paraUTC(weekStart) - paraUTC(ANCORA)) / (7 * DIA));
}

/** As quatro missões de uma semana. Função pura — dá para conferir qualquer data sem tocar no banco. */
export function missoesDaSemana(weekStart) {
  const i = indiceDaSemana(weekStart);
  return CICLOS.map((ciclo) => TEMPLATES[ciclo[mod(i, ciclo.length)]]);
}

/** A data ('YYYY-MM-DD') da quinta que abre a semana de missões vigente. */
export function semanaVigente() {
  return getMissionWeekStart().slice(0, 10);
}

function montarEmbed(weekStart, missoes) {
  const [ano, mes, dia] = weekStart.split('-');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Missões da semana')
    .setDescription(`Semana de **${dia}/${mes}/${ano}** - vale até quarta-feira às 06:00.`)
    .setTimestamp();

  missoes.forEach((m, i) => {
    embed.addFields({
      name: `${i + 1}. ${m.mission}`,
      value: `🎯 Alvo: **${m.target.toLocaleString('pt-BR')}**\n💡 ${m.tip}`.slice(0, 1024),
      inline: false,
    });
  });

  return embed;
}

/** Monta o payload do anúncio. Exportado para dar pra conferir sem enviar nada. */
export function montarAnuncio(weekStart, missoes) {
  const payload = {
    embeds: [montarEmbed(weekStart, missoes)],
    // parse vazio garante que o anúncio nunca notifica ninguém, mesmo que o texto
    // venha a conter algo parecido com menção.
    allowedMentions: { parse: [] },
  };

  // As missões são cadastradas pelo ciclo, sem ninguém conferir contra o jogo, então
  // divergência é possível — o aviso diz onde corrigir sem depender de alguém lembrar
  // do endereço.
  if (config.correcaoUrl) {
    payload.content = `Encontrou alguma divergência? Corrija em ${config.correcaoUrl}`;
  }

  return payload;
}

async function anunciar(client, weekStart, missoes) {
  if (!config.channelId) {
    console.warn('[MISSOES] channelId não configurado - missões cadastradas, anúncio pulado');
    return false;
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[MISSOES] canal ${config.channelId} não encontrado - anúncio pulado`);
    return false;
  }

  await canal.send(montarAnuncio(weekStart, missoes));
  return true;
}

/**
 * Cadastra as missões da semana vigente e anuncia no canal.
 *
 * Não sobrescreve: se a semana já tem missão (alguém cadastrou pelo site, por exemplo),
 * apenas registra no log e sai. Isso torna a execução repetível sem duplicar.
 */
export async function registrarMissoesDaSemana(client) {
  const weekStart = semanaVigente();

  try {
    const existentes = await getMissionsByWeekStart(weekStart);

    if (existentes.length) {
      console.log(`[MISSOES] semana ${weekStart} já tem ${existentes.length} missão(ões) - nada a fazer`);
      return { criadas: 0, weekStart, anunciado: false };
    }

    const missoes = missoesDaSemana(weekStart);
    await insertWeeklyMissions(weekStart, missoes);

    console.log(`[MISSOES] semana ${weekStart} cadastrada (ciclo ${indiceDaSemana(weekStart)}):`);
    missoes.forEach((m, i) => console.log(`  ${i + 1}. ${m.mission} (alvo ${m.target})`));

    const anunciado = await anunciar(client, weekStart, missoes).catch((err) => {
      console.error('[MISSOES] falha ao anunciar:', err.message);
      return false;
    });

    return { criadas: missoes.length, weekStart, anunciado };

  } catch (err) {
    console.error('[MISSOES] falha ao cadastrar a semana', weekStart, err);
    throw err;
  }
}
