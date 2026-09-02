import { EmbedBuilder } from 'discord.js';
import { fetchGuildStatsNewAPI } from '../brawlhalla.js';
import { getMissionWeekStart } from '../db.js';
import { getGuildRegistry, getGuildDuelByWeek, getGuildWeeklyPointsByWeek, saveGuildDuel, saveGuildWeeklyPoints } from '../guild.js';
import { guildDuel as config } from '../../config/index.js';
import { LEADER_ID } from '../../utils/permissions.js';

/**
 * Cadastro automático do duelo semanal — quinta 06:00, no minuto em que a semana vira.
 *
 * O pareamento do jogo é 1º contra 2º, 3º contra 4º, 5º contra 6º — sempre pela classificação
 * corrente. O campo `rank` de /v1/guild/stats é essa posição, não o acumulado de guild points.
 *
 * **Guild points e XP saem da mesma leitura.** Eram duas rotinas em dois horários — duelo na
 * quarta 09:00, XP na quinta 06:00 — porque os dois números têm calendários diferentes: guild
 * points param quando as missões fecham, na quarta 06:00, e XP sobe em qualquer partida, até a
 * virada. A quinta 06:00 respeita os dois de uma vez: o guild point já está parado há 24h e o XP
 * é lido no instante em que a semana começa. Decisão do usuário (02/09/2026), e é o que permite
 * uma chamada por guilda e um `insert` por lado, em vez de um `insert` na quarta e um `update` na
 * quinta.
 */

/** XP que a API não devolveu fica nulo, nunca 0 — ver a nota no `insert` de `guild.js`. */
function numeroOuNulo(valor) {
  const n = Number(valor);
  return valor == null || !Number.isFinite(n) ? null : n;
}

function formatarXp(xp) {
  return xp == null ? '_não lido na API_' : xp.toLocaleString('pt-BR');
}

/** Quem enfrenta quem: 1×2, 3×4, 5×6... */
export function rankDoOponente(nossoRank) {
  return nossoRank % 2 === 1 ? nossoRank + 1 : nossoRank - 1;
}

/** Busca o rank atual de cada guilda monitorada. Falha em uma não derruba as outras. */
async function carregarMonitoradas(guildIds) {
  const guildas = [];

  for (const guildId of guildIds) {
    if (String(guildId) === String(config.ourGuildId)) continue;

    try {
      const g = await fetchGuildStatsNewAPI(guildId);

      guildas.push({
        guildId: String(guildId),
        name: g?.name || `Guilda ${guildId}`,
        rank: Number(g?.rank),
        points: Number(g?.guild_points || 0),
        // Vem da mesma resposta que o rank: descobrir o oponente já traz o XP dele de graça.
        xp: numeroOuNulo(g?.xp),
      });

    } catch (err) {
      console.warn(`[DUELO] falha ao consultar a guilda ${guildId}: ${err.message}`);
    }
  }

  return guildas;
}

function embedCadastrado({ weekStart, nossa, oponente, nossoRank }) {
  const [ano, mes, dia] = weekStart.slice(0, 10).split('-');

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚔️ Duelo da semana cadastrado')
    .setDescription(`Semana de **${dia}/${mes}/${ano}** - enfrentamos a **${oponente.name}**.`)
    .addFields(
      {
        name: `${nossa.name} (nós)`,
        value:
          `🏅 **Posição:** ${nossoRank}º\n` +
          `📈 **Pontos na virada:** ${nossa.points.toLocaleString('pt-BR')}\n` +
          `✨ **XP na virada:** ${formatarXp(nossa.xp)}`,
        inline: true,
      },
      {
        name: oponente.name,
        value:
          `🏅 **Posição:** ${oponente.rank}º\n` +
          `📈 **Pontos na virada:** ${oponente.points.toLocaleString('pt-BR')}\n` +
          `✨ **XP na virada:** ${formatarXp(oponente.xp)}\n` +
          `🆔 ${oponente.guildId}`,
        inline: true,
      },
    )
    .setFooter({ text: 'É contra estas leituras que o .duel mede o ganho da semana' })
    .setTimestamp();
}

/** Payload do aviso de sucesso. Exportado para dar pra conferir sem enviar nada. */
export function montarAnuncio({ weekStart, nossa, oponente, nossoRank }) {
  return {
    content: `Encontrou algum erro? Avise o líder <@${LEADER_ID}>.`,
    embeds: [embedCadastrado({ weekStart, nossa, oponente, nossoRank })],
    // Sem ping aqui: a menção é só para dizer a quem recorrer
    allowedMentions: { parse: [] },
  };
}

/** Payload do aviso de falha. O líder é chamado de verdade nesse caso. */
export function montarAvisoDeFalha(weekStart, motivo) {
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('⚠️ Duelo da semana não foi cadastrado')
    .setDescription(motivo)
    // O lembrete do XP está aqui porque a linha manual é a única que nasce sem ele: a rotina lê
    // guild points e XP juntos, e quem cadastra à mão precisa preencher os dois.
    .setFooter({ text: `Semana ${weekStart.slice(0, 10)} - cadastro manual necessário (guild points e XP)` })
    .setTimestamp();

  return {
    content: `<@${LEADER_ID}>`,
    embeds: [embed],
    allowedMentions: { users: [LEADER_ID] },
  };
}

async function enviar(client, payload) {
  if (!config.channelId) {
    console.warn('[DUELO] channelId não configurado - aviso pulado');
    return false;
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[DUELO] canal ${config.channelId} não encontrado - aviso pulado`);
    return false;
  }

  await canal.send(payload);
  return true;
}

/** Avisa a staff e chama o líder. Usado quando o duelo não pôde ser cadastrado. */
async function avisarFalha(client, weekStart, motivo) {
  await enviar(client, montarAvisoDeFalha(weekStart, motivo))
    .catch(err => console.error('[DUELO] falha ao avisar sobre o erro:', err.message));
}

/**
 * Cadastra o duelo da semana que está começando e avisa no canal da staff.
 *
 * A semana sai de `getMissionWeekStart()`, a mesma âncora do cadastro das missões que roda neste
 * mesmo minuto — se as duas discordarem, é a âncora que está errada, e o sintoma aparece nos dois
 * lugares de uma vez em vez de só aqui.
 *
 * Não sobrescreve: semana que já tem duelo cadastrado (na mão, por exemplo) é deixada como está,
 * então rodar de novo é seguro.
 */
export async function registrarDueloDaSemana(client) {
  const weekStart = getMissionWeekStart();

  try {
    const [dueloExistente, baseExistente] = await Promise.all([
      getGuildDuelByWeek(weekStart),
      getGuildWeeklyPointsByWeek(weekStart),
    ]);

    if (dueloExistente && baseExistente) {
      console.log(`[DUELO] semana ${weekStart} já cadastrada - nada a fazer`);
      return { cadastrado: false, weekStart, motivo: 'JA_EXISTE' };
    }

    const nossaApi = await fetchGuildStatsNewAPI(config.ourGuildId);
    const nossoRank = Number(nossaApi?.rank);

    if (!Number.isFinite(nossoRank) || nossoRank < 1) {
      await avisarFalha(client, weekStart, 'A API não devolveu a posição da TGG, então não dá para saber contra quem é o duelo.');
      return { cadastrado: false, weekStart, motivo: 'SEM_RANK' };
    }

    const nossa = {
      name: nossaApi?.name || 'Team TGG',
      points: Number(nossaApi?.guild_points || 0),
      xp: numeroOuNulo(nossaApi?.xp),
    };

    const rankAlvo = rankDoOponente(nossoRank);
    const registry = await getGuildRegistry();

    if (!registry.length) {
      await avisarFalha(client, weekStart, 'Nenhuma guilda cadastrada em `guild_registry` - sem ela não há como descobrir quem está na posição do nosso par.');
      return { cadastrado: false, weekStart, motivo: 'REGISTRO_VAZIO' };
    }

    const monitoradas = await carregarMonitoradas(registry);
    const oponente = monitoradas.find(g => g.rank === rankAlvo);

    // Guilda nova no topo: ninguém monitorado ocupa a posição do par
    if (!oponente) {
      await avisarFalha(client, weekStart,
        `Estamos em **${nossoRank}º**, então o duelo é contra quem está em **${rankAlvo}º** - e nenhuma das ` +
        `${monitoradas.length} guildas monitoradas está nessa posição.\n\n` +
        `Provavelmente é uma guilda que ainda não está em \`guild_registry\`. Cadastre o \`guild_id\` dela ` +
        `e o duelo da próxima semana já sai sozinho.`
      );
      return { cadastrado: false, weekStart, motivo: 'OPONENTE_DESCONHECIDO', nossoRank, rankAlvo };
    }

    if (!baseExistente) await saveGuildWeeklyPoints(weekStart, nossa.points, nossa.xp);
    if (!dueloExistente) await saveGuildDuel(weekStart, oponente.guildId, oponente.points, oponente.xp);

    console.log(
      `[DUELO] semana ${weekStart}: ${nossoRank}º (${nossa.points} pts, ${nossa.xp ?? 'xp não lido'}) x ` +
      `${oponente.rank}º ${oponente.name} (${oponente.guildId}, ${oponente.points} pts, ${oponente.xp ?? 'xp não lido'})`
    );

    const avisado = await enviar(client, montarAnuncio({ weekStart, nossa, oponente, nossoRank })).catch(err => {
      console.error('[DUELO] falha ao avisar:', err.message);
      return false;
    });

    return { cadastrado: true, weekStart, oponente, nossoRank, avisado };

  } catch (err) {
    // 42703 = coluna não existe. Dizer qual SQL falta poupa caçar o erro na quinta de manhã.
    if (err?.code === '42703') {
      console.error(
        '[DUELO] colunas de XP não existem. Rode:\n' +
        '  alter table guild_weekly_guild_points add column total_xp bigint;\n' +
        '  alter table guild_duels add column xp bigint;'
      );
    }

    console.error('[DUELO] falha ao cadastrar a semana', weekStart, err);
    await avisarFalha(client, weekStart, `Erro inesperado: \`${err.message}\``);
    return { cadastrado: false, weekStart, motivo: 'ERRO', erro: err.message };
  }
}
