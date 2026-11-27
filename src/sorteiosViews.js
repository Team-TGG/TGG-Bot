import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, LabelBuilder, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
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
  return new ModalBuilder().setCustomId(`sorteio_form:${draft.id}`).setTitle(t('Sorteio: enviar para prévia')).addLabelComponents(
    label(t('Prêmio / título do sorteio'), text('prize', draft.prize, 150).setRequired(true).setPlaceholder(t('Ex.: 1 Passe de Batalha'))).setDescription(t('Enviar apenas atualiza a prévia. Publique após revisar.')),
    label(t('Descrição e regras'), text('description', draft.description, 4000, true).setRequired(false).setPlaceholder(t('Ex.: Entrega pelo organizador após o resultado.'))),
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

export function buildSorteioTextForm(draft, t = tradutor(draft.locale)) {
  return new ModalBuilder().setCustomId(`sorteio_texts:${draft.id}`).setTitle(t('Textos do sorteio')).addLabelComponents(
    label(t('Título personalizado (opcional)'), text('title', draft.title, 200).setRequired(false).setPlaceholder(t('Ex.: 🎉 MEGA SORTEIO TGG'))),
    label(t('Descrição com Markdown'), text('description', draft.description, 4000, true).setRequired(false).setPlaceholder(t('Ex.: **Prêmio especial!**\n- Leia as regras\n- Clique para participar')))
      .setDescription(t('Use **negrito**, *itálico*, listas, links e emojis.')),
    label(t('Rodapé personalizado (opcional)'), text('footer', draft.footer, 200).setRequired(false).setPlaceholder(t('Ex.: Boa sorte a todos!'))),
    label(t('Texto do botão de participação'), text('join_label', draft.joinLabel, 40).setRequired(false).setPlaceholder(t('Ex.: 🎉 Quero participar'))),
    label(t('Texto do botão de saída'), text('leave_label', draft.leaveLabel, 40).setRequired(false).setPlaceholder(t('Ex.: Sair da disputa'))),
  );
}

export function buildSorteioMediaForm(draft, t = tradutor(draft.locale)) {
  return new ModalBuilder().setCustomId(`sorteio_media:${draft.id}`).setTitle(t('Cor e imagens do embed')).addLabelComponents(
    label(t('Cor do embed (#RRGGBB)'), text('color', draft.color, 7).setRequired(true).setPlaceholder('#5865F2')),
    label(t('URL da imagem HTTPS (opcional)'), text('image', draft.image, 1000).setRequired(false).setPlaceholder('https://.../banner.png')),
    label(t('URL da miniatura HTTPS (opcional)'), text('thumbnail', draft.thumbnail, 1000).setRequired(false).setPlaceholder('https://.../icone.png')),
  );
}

export function buildSorteioChannelForm(draft, t = tradutor(draft.locale)) {
  const roles = new RoleSelectMenuBuilder().setCustomId('mention_role').setMinValues(0).setMaxValues(1).setRequired(false);
  if (draft.roleId) roles.setDefaultRoles(draft.roleId);
  return new ModalBuilder().setCustomId(`sorteio_channel:${draft.id}`).setTitle(t('Canal e cargo')).addLabelComponents(
    new LabelBuilder().setLabel(t('Onde publicar o sorteio?')).setChannelSelectMenuComponent(
      new ChannelSelectMenuBuilder().setCustomId('channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1).setDefaultChannels(draft.channelId)),
    new LabelBuilder().setLabel(t('Cargo a marcar (opcional)')).setDescription(t('Limpe a seleção para publicar sem marcar cargo.')).setRoleSelectMenuComponent(roles),
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
    .setTitle(record.title || t('Sorteio: {premio}', { premio: record.prize || t('Exemplo: 1 Passe de Batalha') }))
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
  if (record.thumbnail) embed.setThumbnail(record.thumbnail);
  if (record.title) embed.addFields({ name: t('Prêmio'), value: record.prize || t('Exemplo: 1 Passe de Batalha') });
  if (record.status === 'ended') embed.addFields({ name: t('Resultado — rodada {n}', { n: record.rounds.length }),
    value: record.winners.length ? record.winners.map(id => `<@${id}>`).join('\n') : t('Sem participantes elegíveis para esta rodada.') });
  if (preview) embed.addFields({ name: t('Canal de publicação'), value: `<#${record.channelId}>` },
    { name: t('Cargo a marcar'), value: record.roleId ? `<@&${record.roleId}>` : t('Nenhum cargo (sem marcação)') });
  return embed.setFooter({ text: [record.footer, t('Sorteio {id}', { id: record.id })].filter(Boolean).join(' • ') });
}

export function buildSorteioMessage(record) {
  const t = tradutor(record.locale);
  const closed = !['publishing', 'active'].includes(record.status) || record.endsAt <= Date.now();
  return { embeds: [buildSorteioEmbed(record.status === 'publishing' ? { ...record, status: 'active' } : record)], allowedMentions: { parse: [], repliedUser: false }, components: [participationRow(record, t, closed)] };
}

function participationRow(record, t, closed) {
  return new ActionRowBuilder().addComponents(
    button(`sorteio_join:${record.id}`, record.joinLabel || t('Participar'), ButtonStyle.Success).setDisabled(closed),
    button(`sorteio_leave:${record.id}`, record.leaveLabel || t('Sair do sorteio')).setDisabled(closed),
  );
}

export function buildSorteioPreview(draft) {
  const t = tradutor(draft.locale);
  const content = [t('**PRÉVIA — ainda não publicado**'), t('Confira o embed, o canal e o cargo abaixo. Só Publicar sorteio envia o anúncio.'),
    t('Canal: <#{canal}>', { canal: draft.channelId }), t('Cargo: {cargo}', { cargo: draft.roleId ? `<@&${draft.roleId}>` : t('Nenhum cargo (sem marcação)') })].join('\n');
  return { content, embeds: [buildSorteioEmbed(draft, { preview: true })], allowedMentions: { parse: [], repliedUser: false }, components: [participationRow(draft, t, true), new ActionRowBuilder().addComponents(
    button(`sorteio_publish:${draft.id}`, t('Publicar sorteio'), ButtonStyle.Success).setDisabled(!draft.prize),
    button(`sorteio_edit:${draft.id}`, t('Preencher / editar dados'), ButtonStyle.Primary),
    button(`sorteio_styling:${draft.id}`, t('Textos e estilo')),
    button(`sorteio_images:${draft.id}`, t('Cor e imagens')),
    button(`sorteio_target:${draft.id}`, t('Canal e cargo')),
  ), new ActionRowBuilder().addComponents(
    button(`sorteio_appearance:${draft.id}`, t('Duração e aparência')),
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
