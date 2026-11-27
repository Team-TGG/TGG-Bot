import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { EMOJIS } from '../config/emojis.js';

export const QUEUE_PER_PAGE = 8;
export const queuePages = view => Math.max(1, Math.ceil(view.entries.length / QUEUE_PER_PAGE));
const timestamp = value => Math.floor(value / 1000);
const safeName = value => escapeMarkdown(value.replace(/</g, '‹').replace(/>/g, '›')).slice(0, 180).replace(/[\uD800-\uDBFF]$/, '');

export function buildQueueEmbed(view, page, t, icon) {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`${view.region} • Ranked ${view.mode}`).setTimestamp(view.observedAt);
  if (icon) embed.setThumbnail(icon);
  const description = [];
  if (view.status === 'ready' || view.entries.length) {
    description.push(view.mode === '2v2'
      ? t('**{duplas} duplas • {jogadores} jogadores** com atividade recente.', { duplas: t.numero(view.entries.length), jogadores: t.numero(view.players) })
      : t('**{jogadores} jogadores** com atividade recente.', { jogadores: t.numero(view.players) }));
  }
  description.push(t('Atividade estimada pelas partidas dos últimos {minutos} minutos.', { minutos: view.windowMinutes }));
  if (view.status === 'warming') description.push(t('Coletando as primeiras comparações. A lista aparece após detectar novas partidas.'));
  if (['unavailable', 'stale'].includes(view.status)) description.push(t('A consulta ao ranking está atrasada ou indisponível. A lista pode estar incompleta.'));
  embed.setDescription(description.join('\n\n'));
  const start = (page - 1) * QUEUE_PER_PAGE;
  for (const entry of view.entries.slice(start, start + QUEUE_PER_PAGE)) {
    const delta = entry.rankBefore == null ? 0 : entry.rankBefore - entry.rank;
    const arrow = delta > 0 ? EMOJIS.cima : delta < 0 ? EMOJIS.baixo : EMOJIS.symboldash;
    const rating = value => value == null ? '—' : t.numero(value);
    const position = `#${t.numero(entry.rank)}${delta ? ` (${delta > 0 ? '+' : ''}${t.numero(delta)})` : ''}`;
    const winRate = entry.games && entry.wins != null ? new Intl.NumberFormat(t.idioma === 'en' ? 'en-US' : 'pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(entry.wins / entry.games * 100) + '%' : '—';
    embed.addFields({ name: `${arrow} ${safeName(entry.name)}`, value: [
      t('ELO **{elo}** • Pico **{pico}** • {tier}', { elo: rating(entry.rating), pico: rating(entry.peak), tier: escapeMarkdown(entry.tier || '—').slice(0, 64) }),
      t('Posição **{posicao}** • **{partidas}** partidas • **{taxa}** de vitórias', { posicao: position, partidas: t.numero(entry.games), taxa: winRate }),
      t('Sessão: {inicio} • Atividade detectada: {hora}', { inicio: `<t:${timestamp(entry.since)}:R>`, hora: `<t:${timestamp(entry.lastActivityAt)}:R>` }),
    ].join('\n') });
  }
  if (!view.entries.length && view.status === 'ready') embed.addFields({ name: t('Nenhuma atividade recente detectada'), value: t('Nenhum jogador monitorado teve novas partidas nessa janela.') });
  embed.addFields({ name: t('Atualização'), value: [
    view.updatedAt ? t('Última leitura: {hora}', { hora: `<t:${timestamp(view.updatedAt)}:R>` }) : t('Aguardando a primeira leitura do ranking.'),
    view.polling ? t('Verificação do ranking em andamento.') : t('Próxima verificação: {hora}', { hora: `<t:${timestamp(view.nextCheckAt)}:R>` }),
  ].join('\n') });
  return embed.setFooter({ text: t('Página {pagina}/{total} • Top {limite} da região • Fila estimada por atividade', { pagina: page, total: queuePages(view), limite: view.coverage }) });
}
