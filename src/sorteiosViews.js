import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { tradutor } from './i18n/index.js';

export const sorteioLink = record => record.messageId ? `https://discord.com/channels/${record.guildId}/${record.channelId}/${record.messageId}` : null;
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const label = (title, component) => new LabelBuilder().setLabel(title).setTextInputComponent(component);
const text = (id, value, max = 100, paragraph = false) => {
  const input = new TextInputBuilder().setCustomId(id).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(max);
  if (value !== undefined && value !== '') input.setValue(String(value));
  return input;
};

export function sorteioDurationText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return [[Math.floor(seconds / 86400), 'd'], [Math.floor(seconds % 86400 / 3600), 'h'], [Math.floor(seconds % 3600 / 60), 'm'], [seconds % 60, 's']].filter(([value]) => value).map(([value, suffix]) => `${value}${suffix}`).join(' ') || '0m';
}

export function buildSorteioForm(draft, t = tradutor(draft.locale)) {
  const audience = new StringSelectMenuBuilder().setCustomId('audience').setMinValues(1).setMaxValues(1)
    .addOptions({ label: t('Somente membros ativos da TGG'), value: 'members', default: draft.audience === 'members' },
      { label: t('Todos do servidor'), value: 'all', default: draft.audience === 'all' });
  return new ModalBuilder().setCustomId(`sorteio_form:${draft.id}`).setTitle(t('Criar ou editar sorteio')).addLabelComponents(
    label(t('Prêmio / título do sorteio'), text('prize', draft.prize, 150).setRequired(true).setPlaceholder(t('Ex.: 1 Passe de Batalha'))),
    label(t('Descrição e regras'), text('description', draft.description, 1500, true).setRequired(false).setPlaceholder(t('Ex.: Entrega pelo organizador após o resultado.'))),
    label(t('Quantidade de vencedores (1 a 20)'), text('winners', draft.winnerCount, 2).setRequired(true)),
    label(t('Duração: dias, horas e minutos'), text('duration', sorteioDurationText(draft.durationMs), 60).setPlaceholder(t('Ex.: 2d 3h 30m, 12h ou 45m')).setRequired(true)),
    new LabelBuilder().setLabel(t('Quem pode participar?')).setStringSelectMenuComponent(audience),
  );
}

export function buildSorteioVisualForm(draft, t = tradutor(draft.locale)) {
  const minutes = Math.floor(draft.durationMs / 60000);
  return new ModalBuilder().setCustomId(`sorteio_visual:${draft.id}`).setTitle(t('Duração e aparência')).addLabelComponents(
    label(t('Dias'), text('days', Math.floor(minutes / 1440), 2).setRequired(true)),
    label(t('Horas'), text('hours', Math.floor(minutes % 1440 / 60), 3).setRequired(true)),
    label(t('Minutos'), text('minutes', minutes % 60, 4).setRequired(true)),
    label(t('Cor do embed (#RRGGBB)'), text('color', draft.color, 7).setPlaceholder('#5865F2').setRequired(true)),
    label(t('URL da imagem HTTPS (opcional)'), text('image', draft.image, 1000).setPlaceholder('https://.../imagem.png').setRequired(false)),
  );
}

export function buildSorteioChannelForm(draft, t = tradutor(draft.locale)) {
  return new ModalBuilder().setCustomId(`sorteio_channel:${draft.id}`).setTitle(t('Canal de publicação')).addLabelComponents(
    new LabelBuilder().setLabel(t('Onde publicar o sorteio?')).setChannelSelectMenuComponent(
      new ChannelSelectMenuBuilder().setCustomId('channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1).setDefaultChannels(draft.channelId)),
  );
}

export function sorteioStatusText(record, t) {
  if (record.status === 'publishing') return t('Publicação pendente');
  if (record.status === 'cancelled') return t('Cancelado');
  if (record.status === 'ended') return t('Encerrado');
  if (record.status === 'drawing') return t('Conferindo participantes e sorteando');
  return t('Em andamento');
}

export function buildSorteioEmbed(record, { preview = false, now = Date.now() } = {}) {
  const t = tradutor(record.locale);
  const endsAt = preview ? now + record.durationMs : record.status === 'ended' ? record.drawnAt : record.status === 'cancelled' ? record.cancelledAt : record.endsAt;
  const embed = new EmbedBuilder().setColor(Number.parseInt(record.color.slice(1), 16))
    .setTitle(t('Sorteio: {premio}', { premio: record.prize || t('Exemplo: 1 Passe de Batalha') }))
    .setDescription(record.description || t('Clique em Participar para entrar. Uma participação por pessoa.'))
    .addFields(
      { name: t('Público'), value: record.audience === 'members' ? t('Somente membros ativos da TGG') : t('Todos do servidor'), inline: true },
      { name: t('Vencedores'), value: String(record.winnerCount), inline: true },
      { name: t('Participantes'), value: String(record.entries?.length || 0), inline: true },
      { name: t('Encerramento'), value: `<t:${Math.floor(endsAt / 1000)}:F> (<t:${Math.floor(endsAt / 1000)}:R>)` },
      { name: t('Organizador'), value: `<@${record.ownerId}>`, inline: true },
      { name: t('Status'), value: preview ? t('Prévia — ainda não publicado') : sorteioStatusText(record, t), inline: true },
    ).setTimestamp(record.createdAt || now);
  if (record.image) embed.setImage(record.image);
  if (record.status === 'ended') embed.addFields({ name: t('Resultado — rodada {n}', { n: record.rounds.length }),
    value: record.winners.length ? record.winners.map(id => `<@${id}>`).join('\n') : t('Sem participantes elegíveis para esta rodada.') });
  if (preview) embed.addFields({ name: t('Canal de publicação'), value: `<#${record.channelId}>` });
  return embed.setFooter({ text: preview ? t('PRÉVIA • revise e clique em Publicar sorteio') : t('Sorteio {id}', { id: record.id }) });
}

export function buildSorteioMessage(record) {
  const t = tradutor(record.locale);
  const closed = !['publishing', 'active'].includes(record.status) || record.endsAt <= Date.now();
  return { embeds: [buildSorteioEmbed(record.status === 'publishing' ? { ...record, status: 'active' } : record)], allowedMentions: { parse: [], repliedUser: false }, components: [new ActionRowBuilder().addComponents(
    button(`sorteio_join:${record.id}`, t('Participar'), ButtonStyle.Success).setDisabled(closed),
    button(`sorteio_leave:${record.id}`, t('Sair do sorteio')).setDisabled(closed),
  )] };
}

export function buildSorteioPreview(draft) {
  const t = tradutor(draft.locale);
  return { embeds: [buildSorteioEmbed(draft, { preview: true })], allowedMentions: { parse: [], repliedUser: false }, components: [new ActionRowBuilder().addComponents(
    button(`sorteio_publish:${draft.id}`, t('Publicar sorteio'), ButtonStyle.Success).setDisabled(!draft.prize),
    button(`sorteio_edit:${draft.id}`, t('Preencher / editar dados'), ButtonStyle.Primary),
    button(`sorteio_appearance:${draft.id}`, t('Duração e aparência')),
    button(`sorteio_target:${draft.id}`, t('Alterar canal')),
    button(`sorteio_discard:${draft.id}`, t('Descartar prévia'), ButtonStyle.Danger),
  )] };
}

export function buildSorteioManagement(record, t) {
  const message = { embeds: [buildSorteioEmbed(record)], allowedMentions: { parse: [], repliedUser: false }, components: [] };
  const active = ['publishing', 'active', 'drawing'].includes(record.status);
  message.components.push(new ActionRowBuilder().addComponents(
    button(`sorteio_askEnd:${record.id}`, t('Encerrar agora'), ButtonStyle.Primary).setDisabled(record.status !== 'active'),
    button(`sorteio_askCancel:${record.id}`, t('Cancelar sorteio'), ButtonStyle.Danger).setDisabled(!active),
    button(`sorteio_askReroll:${record.id}`, t('Sortear novamente')).setDisabled(record.status !== 'ended'),
  ));
  return message;
}
