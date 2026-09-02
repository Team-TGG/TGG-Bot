import { EmbedBuilder } from 'discord.js';
import { fetchGuildStatsNewAPI } from '../brawlhalla.js';
import { getMissionWeekStart } from '../db.js';
import { getGuildDuelByWeek, getGuildWeeklyPointsByWeek, updateGuildWeeklyXp, updateGuildDuelXp } from '../guild.js';
import { guildDuel as config } from '../../config/index.js';

/**
 * Linha de base de XP das duas guildas do duelo — quinta 06:00, quando a semana vira.
 *
 * **Por que não junto do duelo, na quarta.** O cadastro do duelo
 * ([guildDuelService.js](./guildDuelService.js)) roda na quarta 09:00, e ali guild points já
 * estão fechados: as missões encerram na quarta 06:00 e depois disso não há mais como farmar.
 * O XP não segue esse calendário — ele sobe em qualquer partida, então continua subindo da quarta
 * para a quinta. Capturar na quarta daria uma base já vencida, e o ganho da semana apareceria
 * menor do que foi, comendo tudo o que as duas guildas jogaram na virada.
 *
 * As linhas são as mesmas do duelo (`guild_weekly_guild_points` para nós, `guild_duels` para o
 * oponente), criadas na quarta. Aqui só o XP é preenchido — daí serem `update` e não `insert`.
 *
 * **Só `xp`, nunca `legacy_xp`.** O primeiro é o contador que zerou na atualização de guildas e
 * hoje é o que cresce; o segundo é o acumulado da era anterior, congelado — diferença entre duas
 * capturas dele é sempre 0, então guardá-lo seria repetir o mesmo número em toda linha.
 */

/** O `update` filtra por `is null`, então rodar de novo não reescreve base já lida. */
export const MOTIVO = {
  SEM_LINHAS: 'SEM_LINHAS',
  SEM_COLUNAS: 'SEM_COLUNAS',
};

function embedRegistrado({ weekStart, nos, eles }) {
  const [ano, mes, dia] = weekStart.slice(0, 10).split('-');

  const linha = (lado) => lado.gravado
    ? `✨ **XP na virada:** ${lado.xp.toLocaleString('pt-BR')}`
    : `✨ **XP na virada:** ${lado.xp == null ? '_não lido na API_' : `${lado.xp.toLocaleString('pt-BR')} _(base já existia, mantida)_`}`;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('✨ Base de XP da semana registrada')
    .setDescription(`Semana de **${dia}/${mes}/${ano}** — é contra esta leitura que o \`.duel\` mede o XP ganho.`)
    .addFields(
      { name: `${nos.nome} (nós)`, value: linha(nos), inline: true },
      { name: eles.nome, value: linha(eles), inline: true },
    )
    .setFooter({ text: 'Acompanhe com .duel' })
    .setTimestamp();

  return embed;
}

async function avisar(client, payload) {
  if (!config.channelId) {
    console.warn('[XP SEMANAL] channelId não configurado - aviso pulado');
    return false;
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[XP SEMANAL] canal ${config.channelId} não encontrado - aviso pulado`);
    return false;
  }

  await canal.send(payload);
  return true;
}

/**
 * Grava o XP das duas guildas na linha de base da semana que está começando.
 *
 * A semana sai de `getMissionWeekStart()`, a mesma âncora do cadastro das missões que roda neste
 * mesmo minuto — se as duas discordarem, é a âncora que está errada, e o sintoma aparece nos dois
 * lugares de uma vez em vez de só aqui.
 */
export async function registrarXpDaSemana(client) {
  const weekStart = getMissionWeekStart();

  const [base, duelo] = await Promise.all([
    getGuildWeeklyPointsByWeek(weekStart),
    getGuildDuelByWeek(weekStart),
  ]);

  // Sem as linhas da quarta não há o que preencher. O cadastro do duelo já chamou o líder quando
  // falhou, então aqui é log e não um segundo ping sobre o mesmo problema.
  if (!base && !duelo) {
    console.warn(`[XP SEMANAL] semana ${weekStart} sem linha de base nem duelo - nada a preencher`);
    return { registrado: false, weekStart, motivo: MOTIVO.SEM_LINHAS };
  }

  const nossaApi = await fetchGuildStatsNewAPI(config.ourGuildId).catch(err => {
    console.warn(`[XP SEMANAL] falha ao ler a TGG: ${err.message}`);
    return null;
  });

  const oponenteApi = duelo?.guild_id
    ? await fetchGuildStatsNewAPI(duelo.guild_id).catch(err => {
      console.warn(`[XP SEMANAL] falha ao ler a guilda ${duelo.guild_id}: ${err.message}`);
      return null;
    })
    : null;

  const nos = {
    nome: nossaApi?.name ?? 'Team TGG',
    xp: nossaApi?.xp == null ? null : Number(nossaApi.xp),
    gravado: false,
  };

  const eles = {
    nome: oponenteApi?.name ?? (duelo?.guild_id ? `Guilda ${duelo.guild_id}` : 'Sem oponente'),
    xp: oponenteApi?.xp == null ? null : Number(oponenteApi.xp),
    gravado: false,
  };

  try {
    // XP que a API não devolveu não vira 0: a semana seguinte leria o acumulado inteiro como
    // ganho. Melhor a linha ficar nula e o .duel mostrar "—".
    if (base && nos.xp != null) nos.gravado = await updateGuildWeeklyXp(weekStart, nos.xp) > 0;
    if (duelo && eles.xp != null) eles.gravado = await updateGuildDuelXp(weekStart, eles.xp) > 0;
  } catch (err) {
    // 42703 = coluna não existe. Dizer qual SQL falta é mais útil do que estourar toda quinta.
    if (err?.code === '42703') {
      console.error(
        '[XP SEMANAL] colunas de XP não existem. Rode:\n' +
        '  alter table guild_weekly_guild_points add column total_xp bigint;\n' +
        '  alter table guild_duels add column xp bigint;'
      );
      return { registrado: false, weekStart, motivo: MOTIVO.SEM_COLUNAS };
    }
    throw err;
  }

  console.log(
    `[XP SEMANAL] semana ${weekStart}: ${nos.nome} ${nos.gravado ? nos.xp : 'não gravado'} x ` +
    `${eles.nome} ${eles.gravado ? eles.xp : 'não gravado'}`
  );

  // Nada preenchido = rodada repetida numa semana que já tem base. Silêncio é a resposta certa:
  // o embed diria "registrado" sem ter registrado nada.
  if (!nos.gravado && !eles.gravado) {
    return { registrado: false, weekStart, motivo: null, nos, eles };
  }

  const avisado = await avisar(client, {
    embeds: [embedRegistrado({ weekStart, nos, eles })],
    allowedMentions: { parse: [] },
  }).catch(err => {
    console.error('[XP SEMANAL] falha ao avisar:', err.message);
    return false;
  });

  return { registrado: true, weekStart, nos, eles, avisado };
}
