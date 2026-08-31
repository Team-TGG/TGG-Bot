import { EmbedBuilder } from 'discord.js';
import { calcularContribuicaoSemanal } from './contribuicaoSemanal.js';
import { addTransaction, updateBalance, getTransactionsByTypes } from '../tggCoins.js';
import { weeklyMvp as config, discord as discordConfig } from '../../config/index.js';
import { LEADER_ID } from '../../utils/permissions.js';

/**
 * MVPs da semana: os membros com mais contribuição (guild points ganhos na semana).
 *
 * A contagem é só de recruta/membro — staff (ver `ocupaVaga`) recebe o cargo enquanto ela corre,
 * mas não ocupa vaga. Quando a última vaga é preenchida a lista fecha, então officer que aparece
 * depois disso fica de fora.
 *
 * O número da contribuição vem de [contribuicaoSemanal.js](./contribuicaoSemanal.js), o mesmo que
 * a inativação usa — as duas rotinas precisam concordar sobre quem contribuiu quanto.
 */

/** `users.role` de quem recebe o cargo mas não ocupa vaga na contagem. */
const CARGOS_SEM_VAGA = new Set(['officer', 'admin']);

/** O mesmo, pelo rank do jogo (`/v1/guild/members`). */
const RANKS_SEM_VAGA = new Set(['officer', 'leader']);

/** Sem nenhum ponto na semana não há MVP — o cargo ficaria com quem não jogou. */
const CONTRIBUICAO_MINIMA = 1;

/**
 * Staff é quem é staff em **qualquer um dos dois lados**, porque as duas fontes divergem: em
 * 08/08/2026, 6 pessoas tinham role do banco e rank do jogo diferentes (GGhost_storm é admin no
 * banco e Member no jogo; d'rop é o contrário). Exigir os dois deixaria staff ocupando vaga de
 * membro nas duas direções.
 */
export function ocupaVaga(user, rankNoJogo) {
  if (String(user.discord_id) === LEADER_ID) return false;
  if (CARGOS_SEM_VAGA.has(String(user.role || '').toLowerCase())) return false;
  return !RANKS_SEM_VAGA.has(String(rankNoJogo || '').toLowerCase());
}

/**
 * Percorre o ranking de cima para baixo dando o cargo a todo mundo que passa, mas só contando
 * as vagas de recruta/membro. Fecha assim que a última vaga é preenchida.
 */
export function selecionarMvps(ranking, limite = config.limite) {
  const escolhidos = [];
  let vagas = 0;

  for (const linha of ranking) {
    if (linha.contribuicao < CONTRIBUICAO_MINIMA) break;

    if (linha.ocupaVaga) {
      vagas += 1;
      escolhidos.push({ ...linha, posicao: vagas });

      if (vagas >= limite) break;

    } else {
      escolhidos.push({ ...linha, posicao: null });
    }
  }

  return escolhidos;
}

/**
 * Ranking e MVPs a partir de linhas de contribuição já calculadas. Função pura: não lê banco nem
 * API, então quem já tem as linhas na mão (o `.lb-guilda`) responde "quem está elegível" sem
 * recalcular nada — e responde exatamente o que a quarta-feira vai decidir.
 */
export function selecionarMvpsDasLinhas(linhas, limite = config.limite) {
  const ranking = linhas
    .filter(l => !l.motivo)
    .map(l => ({ ...l, ocupaVaga: ocupaVaga({ discord_id: l.discordId, role: l.role }, l.rankNoJogo) }))
    .sort((a, b) => b.contribuicao - a.contribuicao || a.nome.localeCompare(b.nome, 'pt-BR'));

  return { ranking, mvps: selecionarMvps(ranking, limite) };
}

/**
 * O que separa alguém da vaga de MVP, pela mesma regra de `selecionarMvps`.
 *
 * São dois portões: pontuar na semana e passar a última vaga. Enquanto sobra vaga, o único corte é
 * o mínimo; com a lista fechada, o alvo é a contribuição de **quem ocupa a última vaga**, e não a
 * última posição da lista — staff aparece nela sem ocupar lugar, e mirar nela daria um número que
 * não abre vaga nenhuma. Empate também não entra: a ordenação desempata por nome.
 *
 * Devolve `null` para quem está fora do ranking (contribuição não medida) — ali não há corte que
 * valha, e um número inventado viraria promessa falsa.
 */
export function faltaParaMvp(ranking, mvps, discordId, limite = config.limite) {
  const id = String(discordId);

  if (!ranking.some(l => String(l.discordId) === id)) return null;

  const escolhido = mvps.find(m => String(m.discordId) === id);

  if (escolhido) {
    return { elegivel: true, posicao: escolhido.posicao, faltam: 0, alvo: null };
  }

  const eu = ranking.find(l => String(l.discordId) === id);
  const ocupantes = mvps.filter(m => m.posicao != null);
  const fechada = ocupantes.length >= limite;

  const corte = fechada
    ? Number(ocupantes[ocupantes.length - 1].contribuicao || 0) + 1
    : CONTRIBUICAO_MINIMA;

  return {
    elegivel: false,
    posicao: null,
    faltam: Math.max(0, corte - Number(eu.contribuicao || 0)),
    alvo: fechada ? 'VAGA' : 'MINIMO',
  };
}

/** Lê banco + API e monta o ranking da semana corrente. Não mexe em cargo nenhum. */
export async function calcularMvpsDaSemana() {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();
  const { ranking, mvps } = selecionarMvpsDasLinhas(linhas);

  return {
    weekStart,
    ranking,
    mvps,
    ignorados: linhas.filter(l => l.motivo),
  };
}

/**
 * Deixa o cargo exatamente com quem está na lista: tira de quem saiu, dá a quem entrou e não
 * toca em quem continua. Falha em um membro não derruba os outros.
 */
export async function aplicarCargoMvp(client, mvps) {
  const guild = await client.guilds.fetch(discordConfig.guildId);
  const cargo = await guild.roles.fetch(config.roleId).catch(() => null);

  if (!cargo) {
    throw new Error(`Cargo de MVP ${config.roleId} não encontrado na guilda`);
  }

  // Sem o fetch a role.members só enxerga quem já está em cache — sobrariam MVPs da semana passada
  await guild.members.fetch();

  const novos = new Set(mvps.map(m => m.discordId));
  const atuais = new Set(cargo.members.keys());

  const adicionados = [];
  const removidos = [];
  const falhas = [];

  for (const discordId of atuais) {
    if (novos.has(discordId)) continue;

    try {
      const membro = await guild.members.fetch(discordId);
      await membro.roles.remove(config.roleId);
      removidos.push(discordId);
    } catch (err) {
      falhas.push({ discordId, acao: 'remover', erro: err.message });
    }
  }

  for (const discordId of novos) {
    if (atuais.has(discordId)) continue;

    try {
      const membro = await guild.members.fetch(discordId);
      await membro.roles.add(config.roleId);
      adicionados.push(discordId);
    } catch (err) {
      // Normalmente é quem saiu do Discord mas continua ativo no banco
      falhas.push({ discordId, acao: 'adicionar', erro: err.message });
    }
  }

  return { adicionados, removidos, mantidos: mvps.length - adicionados.length, falhas };
}

function formatPontos(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

/** `2026-08-13 06:00:00` → `13/08/2026`. É a semana que vai no tipo da transação e no anúncio. */
function formatarSemana(weekStart) {
  const [ano, mes, dia] = String(weekStart).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * As três maiores contribuições da semana, em ordem. Diferente das vagas do cargo: aqui **staff
 * concorre normalmente** (decisão do usuário, 18/08/2026), então a posição é a do ranking puro e
 * não o `posicao` da contagem de vagas, que pula quem não ocupa lugar.
 */
export function selecionarPremiados({ weekStart, mvps }, premios = config.premios) {
  const semana = formatarSemana(weekStart);

  return mvps.slice(0, Object.keys(premios).length)
    .map((m, i) => ({ ...m, colocacao: i + 1, valor: premios[i + 1] }))
    .filter(p => p.valor > 0)
    .map(p => ({ ...p, tipo: `TOP ${p.colocacao} SEMANA ${semana}` }));
}

/**
 * Paga os três primeiros em TGG Coins, no mesmo formato do `.addcoins`: uma transação com o tipo
 * `TOP 1 SEMANA 13/08/2026` e o saldo somado.
 *
 * O tipo carrega a semana justamente para servir de trava: o cargo pode ser reaplicado à vontade,
 * moeda não. Quem já recebeu **qualquer** prêmio desta semana é pulado — se o ranking virar entre
 * duas rodadas de quarta-feira, o 1º que virou 2º não pode receber de novo com o outro tipo.
 * Falha em um não impede o pagamento dos outros.
 */
export async function premiarTopMvps({ weekStart, mvps }) {
  const premiados = selecionarPremiados({ weekStart, mvps });

  if (!premiados.length) return { pagos: [], repetidos: [], falhas: [] };

  const lancados = await getTransactionsByTypes(premiados.map(p => p.tipo));
  const jaPagos = new Set(lancados.map(t => String(t.discord_id)));
  const tiposPagos = new Set(lancados.map(t => t.type));

  const pagos = [];
  const repetidos = [];
  const falhas = [];

  for (const premiado of premiados) {
    if (jaPagos.has(premiado.discordId) || tiposPagos.has(premiado.tipo)) {
      repetidos.push(premiado);
      continue;
    }

    const descricao =
      `${premiado.colocacao}º lugar em contribuição na semana de ${formatarSemana(weekStart)} ` +
      `(${formatPontos(premiado.contribuicao)} guild points)`;

    try {
      await addTransaction(premiado.discordId, premiado.valor, premiado.tipo, descricao);
      await updateBalance(premiado.discordId, premiado.valor);

      jaPagos.add(premiado.discordId);
      tiposPagos.add(premiado.tipo);
      pagos.push(premiado);

    } catch (err) {
      falhas.push({ ...premiado, erro: err.message });
    }
  }

  return { pagos, repetidos, falhas };
}

/**
 * Payload do anúncio. Exportado para dar pra conferir sem enviar nada.
 *
 * `premiados` são os que **realmente** ficaram com as moedas (pagos agora ou em rodada anterior);
 * anunciar o prêmio pela regra faria o embed prometer o que uma falha de banco não entregou.
 */
export function montarAnuncio({ weekStart, mvps, premiados = [] }) {
  const [ano, mes, dia] = weekStart.slice(0, 10).split('-');

  const premioPorId = new Map(premiados.map(p => [p.discordId, p.valor]));

  const linhas = mvps.map(m => {
    const posicao = m.posicao ? `**${m.posicao}º**` : '⭐';
    const premio = premioPorId.get(m.discordId);
    const moedas = premio ? ` • 💰 **+${formatPontos(premio)}**` : '';
    return `${posicao} <@${m.discordId}> - ${formatPontos(m.contribuicao)}${moedas}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('🏅 MVPs da semana')
    .setDescription(
      `Semana de **${dia}/${mes}/${ano}** - top ${config.limite} em contribuição.\n` +
      `⭐ = staff, recebe o cargo sem ocupar vaga.\n` +
      `💰 = prêmio em TGG Coins pelas três maiores contribuições, staff incluída.\n\n` +
      (linhas.join('\n') || 'Ninguém pontuou nesta semana.')
    )
    .setTimestamp();

  return {
    embeds: [embed],
    // O cargo já notifica quem ganhou; o anúncio não precisa pingar a lista inteira
    allowedMentions: { parse: [] },
  };
}

async function anunciar(client, payload) {
  if (!config.channelId) {
    console.warn('[MVP] channelId não configurado - cargo trocado, anúncio pulado');
    return false;
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[MVP] canal ${config.channelId} não encontrado - anúncio pulado`);
    return false;
  }

  await canal.send(payload);
  return true;
}

/**
 * Troca os MVPs da semana: calcula o ranking, acerta o cargo e anuncia.
 *
 * Roda na quarta 06:00, quando a semana de missões fecha — o valor lido é o fechamento dela.
 * Repetir a execução é seguro: o cargo é reaplicado para o mesmo conjunto.
 */
export async function trocarMvpsDaSemana(client) {
  try {
    const { weekStart, ranking, mvps, ignorados } = await calcularMvpsDaSemana();

    if (!mvps.length) {
      console.warn(`[MVP] semana ${weekStart}: ninguém pontuou - cargo mantido como está`);
      return { trocado: false, weekStart, motivo: 'SEM_PONTUACAO' };
    }

    const resultado = await aplicarCargoMvp(client, mvps);

    console.log(
      `[MVP] semana ${weekStart}: ${mvps.length} com o cargo ` +
      `(+${resultado.adicionados.length} / -${resultado.removidos.length}), ` +
      `${ranking.length} medidos, ${ignorados.length} sem medição`
    );

    mvps.forEach(m => console.log(
      `  ${m.posicao ? `${m.posicao}º` : ' *'} ${m.nome} (${m.brawlhallaId}) - ${m.contribuicao}`
    ));

    if (resultado.falhas.length) {
      console.warn('[MVP] falhas ao acertar o cargo:', resultado.falhas);
    }

    // Prêmio falhar não pode cancelar o cargo nem o anúncio - são entregas independentes
    const premiacao = await premiarTopMvps({ weekStart, mvps }).catch(err => {
      console.error('[MVP] falha ao premiar o top 3:', err.message);
      return { pagos: [], repetidos: [], falhas: [] };
    });

    premiacao.pagos.forEach(p => console.log(
      `[MVP] ${p.tipo}: ${p.nome} (<@${p.discordId}>) +${p.valor} TGG Coins`
    ));

    if (premiacao.repetidos.length) {
      console.warn(`[MVP] ${premiacao.repetidos.length} prêmio(s) já lançado(s) nesta semana - pulados`);
    }

    if (premiacao.falhas.length) {
      console.warn('[MVP] falhas ao premiar:', premiacao.falhas);
    }

    const premiados = [...premiacao.pagos, ...premiacao.repetidos];

    const anunciado = await anunciar(client, montarAnuncio({ weekStart, mvps, premiados })).catch(err => {
      console.error('[MVP] falha ao anunciar:', err.message);
      return false;
    });

    return { trocado: true, weekStart, mvps, ...resultado, premiacao, anunciado };

  } catch (err) {
    console.error('[MVP] falha ao trocar os MVPs da semana', err);
    throw err;
  }
}
