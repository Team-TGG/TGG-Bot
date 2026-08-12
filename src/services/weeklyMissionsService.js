import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { getMissionsByWeekStart, insertWeeklyMissions, getMissionWeekStart } from '../db.js';
import { weeklyMissions as config } from '../../config/index.js';
import { gerarImagemMissoes } from './missoesImagem.js';

// Os textos abaixo espelham $missionTemplates de cadastro_missao.php, no repo do site
// (C:\xampp\htdocs\TGG). Se um alvo ou dica mudar lá, mude aqui também — as duas listas
// alimentam a mesma tabela e divergir faz a semana entrar com valor errado.
const TEMPLATES = {
  'horda-pesadelo': {
    nome: 'Horda Pesadelo',
    mission: 'Alcance a onda 20 no modo Horda Pesadelo',
    tip: 'Esse modo vai ser muito divertido e vamos completar, basicamente é o modo horda mais difícil, criem um lobby com 4 pessoas e cheguem o mais longe possível, a quantidade de "ondas" (rodadas) vai aumentando a cada tier.',
    target: 16,
  },
  'horda': {
    nome: 'Horda',
    mission: 'Alcance a onda 26 no modo Horda',
    tip: 'Esse modo vai ser muito divertido e vamos completar, criem um lobby com 4 pessoas e cheguem o mais longe possível, a quantidade de "ondas" (rodadas) vai aumentando a cada tier.',
    target: 16,
  },
  'walker-attack': {
    nome: 'Walker Attack',
    mission: 'Alcance a onda 16 no modo Walker Attack',
    tip: 'Quest bacana que envolve PVE, a cada tier vai aumentando um pouco mais a wave que temos que chegar, se junte com um amigo e chegue o mais longe que conseguir.',
    target: 16,
  },
  'ouro-1v1': {
    nome: 'Ouro na Ranked 1v1',
    mission: 'Pegue ouro na Ranked 1v1',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no ouro, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'ouro-2v2': {
    nome: 'Ouro na Ranked 2v2',
    mission: 'Pegue ouro na Ranked 2v2',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no ouro, GANHEM uma partida e a missão será contabilizada. ELO INDIVIDUAL, NÃO O DE TIME',
    target: 125,
  },
  'ouro-3v3': {
    nome: 'Ouro na Ranked 3v3',
    mission: 'Pegue ouro na Ranked 3v3',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no ouro, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'platina-1v1': {
    nome: 'Platina na Ranked 1v1',
    mission: 'Pegue platina na Ranked 1v1',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no platina, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'platina-2v2': {
    nome: 'Platina na Ranked 2v2',
    mission: 'Pegue platina na Ranked 2v2',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no platina, GANHEM uma partida e a missão será contabilizada. ELO INDIVIDUAL, NÃO O DE TIME',
    target: 125,
  },
  'platina-3v3': {
    nome: 'Platina na Ranked 3v3',
    mission: 'Pegue platina na Ranked 3v3',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no platina, GANHEM uma partida e a missão será contabilizada.',
    target: 125,
  },
  'diamante-1v1': {
    nome: 'Diamante na Ranked 1v1',
    mission: 'Pegue diamante na Ranked 1v1',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no diamante, GANHEM uma partida e a missão será contabilizada.',
    target: 100,
  },
  'diamante-2v2': {
    nome: 'Diamante na Ranked 2v2',
    mission: 'Pegue diamante na Ranked 2v2',
    tip: 'Façam a MD10 e ganhem uma partida para contabilizar na aba de missões. Caso já estejam no diamante, GANHEM uma partida e a missão será contabilizada. ELO INDIVIDUAL, NÃO O DE TIME',
    target: 100,
  },
  'diamante-3v3': {
    nome: 'Diamante na Ranked 3v3',
    mission: 'Pegue diamante na Ranked 3v3',
    tip: 'NÃO FAÇAM ESSA QUEST',
    target: 100,
  },
  'botw': {
    nome: 'Brawl of the Week',
    mission: 'Vitórias no Brawl of the Week',
    tip: 'É necessário GANHAR.',
    target: 750,
  },
  'ranked-3v3': {
    nome: 'Ranked 3v3 com a Guilda',
    mission: 'Ranked 3v3 com membro da guilda',
    tip: 'Não é necessário vencer, apenas jogar. O trio PRECISA ser composto por membros da guilda pra contabilizar',
    target: 2800,
  },
  'ranked-2v2': {
    nome: 'Ranked 2v2 com a Guilda',
    mission: 'Ranked 2v2 com membro da guilda',
    tip: 'Não é necessário vencer, apenas jogar. Precisa jogar com um membro da guilda pra contabilizar',
    target: 3750,
  },
  'crew-battle': {
    nome: 'Crew Battle',
    mission: 'Jogos de Crew Battle',
    tip: 'Crie um lobby com o maior número de jogadores possível, coloque todos os jogadores em um time e APENAS UM em um outro time (7 jogadores no time azul e 1 no vermelho). Depois, só dar dano o suficiente pra contabilizar XP (aproximadamente 100 de dano) e deixe o jogador que está sozinho se matar 3 vezes.',
    target: 1000,
  },
  'brawlball': {
    nome: 'Brawlball',
    mission: 'Jogos de Brawlball',
    tip: 'Crie um Lobby com o máximo de pessoas possível, apenas uma equipe faz o ponto, enquanto as outras dão dano uma na outra (acho que uns 80 de dano) para contar xp, ou seja, todo jogo tem que terminar 5 x 0.',
    target: 1000,
  },
  'kungfoot': {
    nome: 'Kung Foot',
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

/**
 * As chaves das quatro missões de uma semana, na ordem das posições. É o que a arte precisa:
 * o slug é o nome do print em assets/missoes/.
 */
export function slugsDaSemana(weekStart) {
  const i = indiceDaSemana(weekStart);
  return CICLOS.map((ciclo) => ciclo[mod(i, ciclo.length)]);
}

/** As quatro missões de uma semana. Função pura — dá para conferir qualquer data sem tocar no banco. */
export function missoesDaSemana(weekStart) {
  return slugsDaSemana(weekStart).map((slug) => TEMPLATES[slug]);
}

/** A data ('YYYY-MM-DD') da quinta que abre a semana de missões vigente. */
export function semanaVigente() {
  return getMissionWeekStart().slice(0, 10);
}

/**
 * A quinta seguinte a `weekStart`. Em UTC, como o resto do cálculo de ciclo: somar 7 dias em hora
 * local passaria a semana errada na virada do horário de verão.
 */
export function semanaSeguinte(weekStart = semanaVigente()) {
  return new Date(paraUTC(weekStart) + 7 * DIA).toISOString().slice(0, 10);
}

const ARQUIVO_ARTE = 'missoes.png';

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

/** O aviso da staff, em log-guilda. Exportado para dar pra conferir sem enviar nada. */
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

const ABERTURA = '# NOVAS MISSÕES\n'
  + 'mais uma quinta-feira e nessa semana temos potencial para fazer muitos pontos. '
  + 'Como sempre, aqui vai um resumo com dicas de todas as missões.';

/**
 * O texto do post. Este anúncio é a exceção ao "toda saída é embed" do projeto: ele vai para
 * o canal público com ping do @TGG, e embed em mensagem com menção fica pequeno no celular —
 * o modelo em markdown foi definido pelo usuário em 12/08/2026.
 *
 * Puro: dá pra conferir o texto inteiro sem enviar nada.
 */
export function montarTexto(missoes) {
  const blocos = missoes.map((m) => [
    `## ${m.nome}`,
    `**${m.mission}**`,
    `*${m.tip}*`,
    `0/${m.target.toLocaleString('pt-BR')}`,
  ].join('\n'));

  const partes = [ABERTURA, ...blocos];

  if (config.roleId) partes.push(`<@&${config.roleId}>`);

  return partes.join('\n\n');
}

/** O post da guilda, em guild-updates. Exportado para dar pra conferir sem enviar nada. */
export function montarPost(missoes, arte = null, { mencionar = true } = {}) {
  const payload = {
    content: montarTexto(missoes),
    // O ping do @TGG é o ponto do post, mas tem que ser o único: restringir a `roles` impede
    // que um @everyone ou um @membro escrito no texto de uma dica vire notificação. Prévia
    // passa `mencionar: false` e não notifica ninguém.
    allowedMentions: mencionar && config.roleId ? { roles: [config.roleId] } : { parse: [] },
  };

  if (arte) payload.files = [new AttachmentBuilder(arte, { name: ARQUIVO_ARTE })];

  return payload;
}

async function enviar(client, channelId, payload, rotulo) {
  if (!channelId) {
    console.warn(`[MISSOES] canal de ${rotulo} não configurado - envio pulado`);
    return false;
  }

  const canal = await client.channels.fetch(channelId).catch(() => null);

  if (!canal) {
    console.warn(`[MISSOES] canal ${channelId} (${rotulo}) não encontrado - envio pulado`);
    return false;
  }

  await canal.send(payload);
  return true;
}

/**
 * As duas saídas da quinta-feira: o aviso da staff em log-guilda e o post da guilda em
 * guild-updates. Uma não depende da outra — se o post falhar, a staff ainda recebe o aviso
 * de conferência, que é o que permite corrigir o cadastro antes de alguém reclamar.
 */
async function anunciar(client, weekStart, missoes) {
  const aviso = await enviar(client, config.channelId, montarAnuncio(weekStart, missoes), 'aviso')
    .catch((err) => {
      console.error('[MISSOES] falha ao avisar a staff:', err.message);
      return false;
    });

  // Print faltando ou corrompido não pode custar o post: a informação está no texto, a arte
  // é o chamariz.
  const arte = await gerarImagemMissoes(slugsDaSemana(weekStart)).catch((err) => {
    console.warn('[MISSOES] arte não gerada, postando sem imagem:', err.message);
    return null;
  });

  const post = await enviar(client, config.postChannelId, montarPost(missoes, arte), 'post')
    .catch((err) => {
      console.error('[MISSOES] falha ao postar para a guilda:', err.message);
      return false;
    });

  return { aviso, post };
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
      return { criadas: 0, weekStart, aviso: false, post: false };
    }

    const missoes = missoesDaSemana(weekStart);
    await insertWeeklyMissions(weekStart, missoes);

    console.log(`[MISSOES] semana ${weekStart} cadastrada (ciclo ${indiceDaSemana(weekStart)}):`);
    missoes.forEach((m, i) => console.log(`  ${i + 1}. ${m.mission} (alvo ${m.target})`));

    const { aviso, post } = await anunciar(client, weekStart, missoes).catch((err) => {
      console.error('[MISSOES] falha ao anunciar:', err.message);
      return { aviso: false, post: false };
    });

    return { criadas: missoes.length, weekStart, aviso, post };

  } catch (err) {
    console.error('[MISSOES] falha ao cadastrar a semana', weekStart, err);
    throw err;
  }
}
