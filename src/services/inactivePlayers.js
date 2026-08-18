import { EmbedBuilder } from 'discord.js';
import { getInactivePlayers, removeInactivePlayer } from '../db.js';
import { calcularContribuicaoSemanal } from './contribuicaoSemanal.js';
import { CONTRIBUICAO_MINIMA } from './weeklyInactiveService.js';
import { discord as discordConfig, inactivePlayers as inactivePlayersConfig } from '../../config/index.js';

/** Justificativa gravada em `weekly_inactive_players.note` - é o que a staff lê no histórico. */
const NOTA_AUTOMATICA = 'pegou 1k+ de contribuição e saiu da lista automaticamente';

/** Teto de linhas do anúncio. Lista cortada tem que dizer que foi cortada. */
const MAX_LINHAS_ANUNCIO = 25;

/**
 * Tira da lista quem já bateu o mínimo na semana corrente, antes de o lembrete sair.
 *
 * A lista é da semana passada e o lembrete roda de 3 em 3h durante a semana inteira: sem isso,
 * quem já se recuperou seguiria sendo pingado e recebendo DM até a quarta seguinte, cobrando uma
 * contribuição que ele já fez. Faz o mesmo que o `.active` - grava a nota e tira o cargo.
 *
 * O número vem de `calcularContribuicaoSemanal()`, o mesmo que decide MVP e inativação: ler de
 * outra fonte faria alguém sair da lista com um valor que a quarta-feira não reconhece.
 *
 * Quem voltou com `motivo` (sem base, base zerada, fora da guilda) **não** sai: 0 e "não sei" são
 * coisas diferentes, e liberar sem medição apagaria a marcação sem prova nenhuma. Na janela de
 * quarta 06:00 a quinta 06:00 a conta ainda descreve a semana fechada, em que ninguém da lista
 * chegou aos 1.000 - ninguém sai, e é o resultado certo.
 */
export async function liberarQuemContribuiu(client) {
  const naLista = await getInactivePlayers();
  if (!naLista.length) return [];

  const { linhas } = await calcularContribuicaoSemanal();
  const porConta = new Map(linhas.map(l => [String(l.brawlhallaId), l]));

  const liberados = [];

  for (const player of naLista) {
    const linha = porConta.get(String(player.brawlhalla_id));

    if (!linha || linha.motivo) continue;
    if (linha.contribuicao < CONTRIBUICAO_MINIMA) continue;

    try {
      await removeInactivePlayer(player.discord_id, NOTA_AUTOMATICA);
    } catch (err) {
      console.warn(`[Inactive Reminder] Não saiu da lista ${linha.nome} (${player.discord_id}): ${err.message}`);
      continue;
    }

    liberados.push({ discordId: String(player.discord_id), nome: linha.nome, contribuicao: linha.contribuicao });
  }

  if (!liberados.length) return [];

  await removerCargoDeInativo(client, liberados);
  await anunciarLiberados(client, liberados);

  console.log(`[Inactive Reminder] ${liberados.length} saíram da lista por contribuição`);
  liberados.forEach(l => console.log(`  ${l.nome} (${l.discordId}) - ${l.contribuicao}`));

  return liberados;
}

// Cargo e anúncio falham separado da gravação: a nota já garante que o lembrete não cobra de novo.
async function removerCargoDeInativo(client, liberados) {
  const guild = await client.guilds.fetch(discordConfig.guildId).catch(() => null);
  if (!guild) return;

  for (const liberado of liberados) {
    const membro = await guild.members.fetch(liberado.discordId).catch(() => null);
    if (!membro || !membro.roles.cache.has(inactivePlayersConfig.inactiveRoleId)) continue;

    await membro.roles.remove(inactivePlayersConfig.inactiveRoleId).catch(err => {
      console.warn(`[Inactive Reminder] Cargo não removido de ${liberado.nome}: ${err.message}`);
    });
  }
}

/** Aviso na log-guilda, sem ping: é informação para a staff, não cobrança para o membro. */
async function anunciarLiberados(client, liberados) {
  const canal = await client.channels.fetch(inactivePlayersConfig.avisoChannelId).catch(() => null);

  if (!canal) {
    console.warn(`[Inactive Reminder] Canal ${inactivePlayersConfig.avisoChannelId} não encontrado - anúncio pulado`);
    return;
  }

  const linhas = liberados
    .slice(0, MAX_LINHAS_ANUNCIO)
    .map(l => `<@${l.discordId}> - **${l.contribuicao.toLocaleString('pt-BR')}** de contribuição`);

  const sobraram = liberados.length - linhas.length;
  if (sobraram > 0) linhas.push(`… e mais ${sobraram}`);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Saíram da lista de inativos')
    .setDescription(
      `Bateram os **${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')} de contribuição** nesta semana e ` +
      `foram removidos da lista automaticamente.\n\n${linhas.join('\n')}`
    )
    .setTimestamp();

  await canal.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(err => {
    console.warn(`[Inactive Reminder] Falha ao anunciar liberados: ${err.message}`);
  });
}

export async function sendInactivePlayersReminder(client) {
    try {
      // Antes de cobrar: quem já bateu o mínimo sai da lista. Falha aqui não cancela o lembrete -
      // deixar de avisar a lista inteira é pior do que cobrar alguém que já se resolveu.
      await liberarQuemContribuiu(client).catch(err => {
        console.error('[Inactive Reminder] Falha ao liberar quem contribuiu:', err.message);
      });

      const channelId = inactivePlayersConfig.channelId;
      if (!channelId) {
        console.log('[Inactive Reminder] INACTIVE_PLAYERS_CHANNEL_ID not configured, skipping');
        return;
      }

      const channel = client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`[Inactive Reminder] Channel ${channelId} not found`);
        return;
      }

      const inactivePlayers = await getInactivePlayers();

      if (inactivePlayers.length === 0) {
        console.log('[Inactive Reminder] No inactive players');
        return;
      }

      const mentions = inactivePlayers
        .filter(p => p.discord_id)
        .map(p => `<@${p.discord_id}>`)
        .join(' ');

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle('⚠️ Lembrete: Usuários Inativos')
        .setDescription(`Olá! Se você está nesta lista, significa que fez menos de 1.000 de contribuição na semana passada e foi marcado como inativo. 

          Para saber como contribuir, veja o canal <#${'1480627066792579072'}> ou fale com um membro da staff.

          Para mostrar que está ativo, use o comando \`.active\` com uma justificativa para se remover da lista.
          
          Ex: \`.active Estava viajando e não consegui jogar.\``)
        .setTimestamp();

      await channel.send({
        content: mentions, // Mencionar os players fora do embed pra pingar
        embeds: [embed],
        allowedMentions: {
          users: inactivePlayers
            .filter(p => p.discord_id)
            .map(p => p.discord_id),
        }
      });

      // DM
      const dmEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('⚠️ Aviso de Inatividade')
        .setDescription(`Você fez menos de 1.000 de contribuição e ficou inativo. Por favor, vá para o canal <#1468600851290521692> e leia o lembrete do TGG-Bot para mais informações, evite ser removido da guilda.`)
        .setTimestamp();

      for (const player of inactivePlayers) {
        if (!player.discord_id) continue;
        try {
          const user = await client.users.fetch(player.discord_id).catch(() => null);
          if (user) {
            await user.send({ embeds: [dmEmbed] }).catch(() => {
              console.log(`[Inactive Reminder] Could not send DM to ${player.discord_id}`);
            });
          }
        } catch (err) {
          console.log(`[Inactive Reminder] Failed to DM ${player.discord_id}: ${err.message}`);
        }
      }

      console.log(`[Inactive Reminder] Sent message and DMs with ${inactivePlayers.length} inactive players`);
    } catch (err) {
      console.error('[Inactive Reminder Error]', err);
    }
}

export function startInactiveReminder(client) {
    if (!inactivePlayersConfig.messageEnabled) {
        console.log('[Inactive Reminder] Disabled in config');
        return;
    }

    const interval = Number(inactivePlayersConfig.messageInterval) || 10800000; // 3h

    setInterval(() => {
        sendInactivePlayersReminder(client);
    }, interval);

    setTimeout(() => {
        sendInactivePlayersReminder(client);
    }, 5000);
}
