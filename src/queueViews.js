import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { EMOJIS } from '../config/emojis.js';

export const QUEUE_PER_PAGE = 8;
export const queuePages = view => Math.max(1, Math.ceil(view.entries.length / QUEUE_PER_PAGE));
const timestamp = value => Math.floor(value / 1000);
const safeName = value => escapeMarkdown(value.replace(/</g, '‹').replace(/>/g, '›')).slice(0, 180).replace(/[\uD800-\uDBFF]$/, '');
const rankBadge = tier => {
  const key = ['Valhallan', 'Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Tin'].find(rank => String(tier).toLowerCase().startsWith(rank.toLowerCase()));
  return EMOJIS[`rank${key}`] || EMOJIS.trophy;
};

export function buildQueueEmbed(view, page, t, icon) {
  const color = view.status === 'unavailable' ? 0xed4245 : view.status === 'stale' ? 0xfee75c : 0x5865f2;
  const author = { name: t('TGG • MONITOR DE RANQUEADA') };
  if (icon) author.iconURL = icon;
  const embed = new EmbedBuilder().setColor(color).setAuthor(author)
    .setTitle(`${EMOJIS.brazil} ${view.region} • Ranked ${view.mode}`).setTimestamp(view.observedAt);
  if (icon) embed.setThumbnail(icon);
  const status = view.status === 'ready' ? `${EMOJIS.success} **${t('ATIVIDADE RECENTE')}**`
    : view.status === 'warming' ? `${EMOJIS.loading} **${t('COLETANDO ATIVIDADE')}**`
      : `${EMOJIS.hourglass} **${t('AGUARDANDO ATUALIZAÇÃO')}**`;
  const description = [status];
  if (view.status === 'ready' || view.entries.length) {
    description.push(view.mode === '2v2'
      ? t('**{duplas} duplas • {jogadores} jogadores** com atividade recente.', { duplas: t.numero(view.entries.length), jogadores: t.numero(view.players) })
      : t('**{jogadores} jogadores** com atividade recente.', { jogadores: t.numero(view.players) }));
  }
  description.push(`*${t('Atividade estimada pelas partidas dos últimos {minutos} minutos.', { minutos: view.windowMinutes })}*`);
  if (view.status === 'warming') description.push(t('Coletando as primeiras comparações. A lista aparece após detectar novas partidas.'));
  if (['unavailable', 'stale'].includes(view.status)) description.push(t('A consulta ao ranking está atrasada ou indisponível. A lista pode estar incompleta.'));
  embed.setDescription(description.join('\n\n'));
  const ratings = view.entries.map(entry => entry.rating).filter(value => Number.isSafeInteger(value) && value >= 0);
  embed.addFields(
    { name: `${EMOJIS.trophy} ${t('ELO médio')}`, value: ratings.length ? `**${t.numero(Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length))}**` : '—', inline: true },
    { name: `${EMOJIS.chart} ${t('Faixa de ELO')}`, value: ratings.length ? `\`${t.numero(Math.min(...ratings))} – ${t.numero(Math.max(...ratings))}\`` : '—', inline: true },
    { name: `${EMOJIS.clock} ${t('Janela ativa')}`, value: t('**{minutos} min**', { minutos: view.windowMinutes }), inline: true },
  );
  const start = (page - 1) * QUEUE_PER_PAGE;
  for (const [index, entry] of view.entries.slice(start, start + QUEUE_PER_PAGE).entries()) {
    const delta = entry.rankBefore == null ? 0 : entry.rankBefore - entry.rank;
    const arrow = delta > 0 ? EMOJIS.cima : delta < 0 ? EMOJIS.baixo : EMOJIS.symboldash;
    const rating = value => value == null ? '—' : t.numero(value);
    const position = `#${t.numero(entry.rank)}${delta ? ` (${delta > 0 ? '+' : ''}${t.numero(delta)})` : ''}`;
    const winRate = entry.games && entry.wins != null ? new Intl.NumberFormat(t.idioma === 'en' ? 'en-US' : 'pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(entry.wins / entry.games * 100) + '%' : '—';
    embed.addFields({ name: `${arrow} ${String(start + index + 1).padStart(2, '0')}  ${safeName(entry.name)}`, value: [
      `${rankBadge(entry.tier)} ${t('**{elo} ELO** • Pico `{pico}` • {tier}', { elo: rating(entry.rating), pico: rating(entry.peak), tier: escapeMarkdown(entry.tier || '—').slice(0, 32) })}`,
      `${EMOJIS.chart} **${position}**  ${EMOJIS.gamepad} ${t('`{partidas}` partidas', { partidas: t.numero(entry.games) })}  ${EMOJIS.target} ${t('`{taxa}` vitórias', { taxa: winRate })}`,
      `${EMOJIS.clock} ${t('Sessão: {inicio} • Atividade: {hora}', { inicio: `<t:${timestamp(entry.since)}:R>`, hora: `<t:${timestamp(entry.lastActivityAt)}:R>` })}`,
    ].join('\n'), inline: false });
  }
  if (!view.entries.length && view.status === 'ready') embed.addFields({ name: t('Nenhuma atividade recente detectada'), value: t('Nenhum jogador monitorado teve novas partidas nessa janela.') });
  embed.addFields(
    { name: `${EMOJIS.clock} ${t('Última leitura')}`, value: view.updatedAt ? `<t:${timestamp(view.updatedAt)}:R>` : t('Aguardando a primeira leitura do ranking.'), inline: true },
    { name: `${EMOJIS.refresh} ${t('Próxima leitura')}`, value: view.polling ? t('Verificação do ranking em andamento.') : `<t:${timestamp(view.nextCheckAt)}:R>`, inline: true },
  );
  return embed.setFooter({ text: t('TGG • Página {pagina}/{total} • Top {limite} BRZ • Atividade estimada', { pagina: page, total: queuePages(view), limite: view.coverage }) });
}
