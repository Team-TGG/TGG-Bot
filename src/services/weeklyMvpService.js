import { EmbedBuilder } from 'discord.js';
import { calcularContribuicaoSemanal } from './contribuicaoSemanal.js';
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

/** Lê banco + API e monta o ranking da semana corrente. Não mexe em cargo nenhum. */
export async function calcularMvpsDaSemana() {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();

  const ranking = linhas
    .filter(l => !l.motivo)
    .map(l => ({ ...l, ocupaVaga: ocupaVaga({ discord_id: l.discordId, role: l.role }, l.rankNoJogo) }))
    .sort((a, b) => b.contribuicao - a.contribuicao || a.nome.localeCompare(b.nome, 'pt-BR'));

  return {
    weekStart,
    ranking,
    mvps: selecionarMvps(ranking),
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

/** Payload do anúncio. Exportado para dar pra conferir sem enviar nada. */
export function montarAnuncio({ weekStart, mvps }) {
  const [ano, mes, dia] = weekStart.slice(0, 10).split('-');

  const linhas = mvps.map(m => {
    const posicao = m.posicao ? `**${m.posicao}º**` : '⭐';
    return `${posicao} <@${m.discordId}> - ${formatPontos(m.contribuicao)}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('🏅 MVPs da semana')
    .setDescription(
      `Semana de **${dia}/${mes}/${ano}** - top ${config.limite} em contribuição.\n` +
      `⭐ = staff, recebe o cargo sem ocupar vaga.\n\n` +
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

    const anunciado = await anunciar(client, montarAnuncio({ weekStart, mvps })).catch(err => {
      console.error('[MVP] falha ao anunciar:', err.message);
      return false;
    });

    return { trocado: true, weekStart, mvps, ...resultado, anunciado };

  } catch (err) {
    console.error('[MVP] falha ao trocar os MVPs da semana', err);
    throw err;
  }
}
