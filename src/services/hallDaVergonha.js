// Post público das punições da staff no 🔕｜hall-da-vergonha, no lugar do Apolo.
// Quem aplicou nunca aparece (decisão do usuário, 19/10/2026): o canal expõe a punição, não a staff.
// O mute da loja não passa por aqui — é brincadeira paga, não punição.
import { EmbedBuilder } from 'discord.js';
import { hallDaVergonha as config } from '../../config/index.js';

const ESTILOS = {
  warn: { titulo: '⚠️ Warn', cor: 0xfee75c },
  mute: { titulo: '🔇 Mute', cor: 0xe67e22 },
  kick: { titulo: '👢 Kick', cor: 0xe74c3c },
  ban:  { titulo: '🔨 Ban',  cor: 0x992d22 },
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {{ tipo: 'warn'|'mute'|'kick'|'ban', alvo: import('discord.js').User,
 *           motivo: string, duracao?: string, extras?: string[] }} punicao
 */
export async function postarPunicao(guild, { tipo, alvo, motivo, duracao, extras = [] }) {
  if (!config.channelId) return;

  try {
    const canal = guild.channels.cache.get(config.channelId)
      ?? await guild.channels.fetch(config.channelId);
    const estilo = ESTILOS[tipo];

    const linhas = [`**Membro:** <@${alvo.id}> (${alvo.username})`, `**Motivo:** ${motivo}`];
    if (duracao) linhas.push(`**Duração:** ${duracao}`);
    linhas.push(...extras);

    const embed = new EmbedBuilder()
      .setColor(estilo.cor)
      .setTitle(estilo.titulo)
      .setDescription(linhas.join('\n'))
      .setThumbnail(alvo.displayAvatarURL())
      .setTimestamp();

    // Embed não pinga, mas allowedMentions vazio garante isso mesmo se a menção sair no content
    await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.warn(`[HallDaVergonha] Could not post ${tipo} for ${alvo.id}: ${err.message}`);
  }
}
