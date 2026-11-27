import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { hasPermission, isAdmin } from '../../utils/permissions.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed } from '../../utils/discordUtils.js';
import { tradutor } from '../i18n/index.js';
import { getSorteiosService } from '../services/sorteiosRuntime.js';
import { parseSorteioDuration, sorteioError } from '../services/sorteiosService.js';
import { buildSorteioForm, buildSorteioVisualForm, buildSorteioTextForm, buildSorteioMediaForm, buildSorteioChannelForm, buildSorteioPreview, buildSorteioManagement, sorteioLink, sorteioStatusText } from '../sorteiosViews.js';

const safe = { allowedMentions: { parse: [], repliedUser: false } };
const actor = source => source.user?.id || source.author?.id;
const guildId = source => source.guildId || source.guild?.id;
const channelId = source => source.channelId || source.channel?.id;

async function defaultCanManage(source) {
  const id = actor(source);
  const member = Array.isArray(source.member?.roles)
    ? { id, roles: { cache: new Map(source.member.roles.map(id => [id, { id }])) } }
    : source.member || { id };
  return hasPermission(member, 1) || await isAdmin(id);
}

export function sorteioErrorEmbed(error, source) {
  const t = tradutor(source);
  const messages = {
    DURATION: t('Use uma duração entre 1 minuto e 30 dias. Exemplo: 2d 3h 30m.'),
    TEXT: t('Informe um prêmio de até 150 caracteres e uma descrição de até 4000 caracteres.'),
    STYLE: t('Use até 200 caracteres no título/rodapé e 40 em cada botão.'),
    WINNERS: t('Escolha de 1 a 20 vencedores.'), AUDIENCE: t('Escolha membros da TGG ou todos do servidor.'),
    COLOR: t('A cor deve estar no formato #RRGGBB, como #5865F2.'), IMAGE: t('Use uma URL de imagem HTTPS válida, sem usuário ou senha.'),
    CHANNEL: t('Escolha um canal de texto deste servidor.'),
    ROLE: t('Escolha um cargo deste servidor, @everyone ou deixe sem marcação.'),
    ROLE_PERMISSIONS: t('O bot precisa da permissão de mencionar @everyone, @here e todos os cargos no canal escolhido.'),
    CHANNEL_PERMISSIONS: t('O organizador precisa ver o canal; o bot precisa ver, enviar mensagens, incorporar links e ler o histórico.'),
    NOT_FOUND: t('Sorteio não encontrado neste servidor. Use o ID ou o link da mensagem.'),
    DRAFT: t('Essa prévia expirou ou pertence a outra pessoa. Abra um novo formulário com /sorteio.'),
    DRAFT_LIMIT: t('Você já tem muitas prévias abertas. Descarte uma delas antes de criar outra.'),
    ALREADY_PUBLISHED: t('Esta prévia já foi publicada. Use /sorteio para gerenciar o sorteio.'),
    PUBLICATION_PENDING: t('A publicação está sendo conferida. Verifique o canal e tente gerenciar novamente; o bot não publicará uma cópia.'),
    ACTIVE_LIMIT: t('O servidor já tem 20 sorteios em andamento. Encerre ou cancele um antes de criar outro.'),
    CLOSED: t('Este sorteio já encerrou ou está sendo apurado.'), NOT_DUE: t('Este sorteio ainda não chegou ao horário de encerramento.'),
    MEMBERS_ONLY: t('Este sorteio é só para membros ativos da TGG cadastrados no bot.'),
    SERVER_ONLY: t('Esta ação exige uma pessoa que esteja no servidor. Bots não participam.'),
    ENTRY_LIMIT: t('Este sorteio atingiu o limite de 5000 participantes.'), MESSAGE: t('Use os botões da mensagem original do sorteio.'),
    MANAGER: t('Apenas assistants, helpers ou superiores podem criar e gerenciar sorteios.'),
    ACTION_OWNER: t('Esta confirmação pertence a outra pessoa.'),
    NO_ELIGIBLE: t('Não restam participantes elegíveis que ainda não ganharam. O resultado anterior foi mantido.'),
  };
  return createErrorEmbed(t('Não foi possível concluir o sorteio'), messages[error.sorteioCode] || t('O serviço de sorteios está temporariamente indisponível. Tente novamente em instantes.'));
}

async function replyInteraction(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({ ...safe, ...payload });
  return interaction.reply({ ...safe, ...payload, flags: MessageFlags.Ephemeral });
}

async function deferPreview(interaction) {
  if (interaction.message) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

export function createSorteioHandlers({ getService = getSorteiosService, canManage = defaultCanManage, logger = console } = {}) {
  async function requireManager(source) {
    if (!guildId(source)) throw sorteioError('SERVER_ONLY');
    if (!await canManage(source)) throw sorteioError('MANAGER');
  }
  async function resolveRecord(service, reference, server, client) {
    const input = String(reference || '').trim();
    const link = input.match(/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/);
    if (link && link[1] !== server) throw sorteioError('NOT_FOUND');
    let record = (await service.list(server)).find(record => record.id === input || record.messageId === input || (link && record.channelId === link[2] && record.messageId === link[3]));
    // Recupera publicação confirmada pelo Discord antes de uma queda, mesmo fora das 100 mensagens recentes.
    if (!record && link) {
      const channel = await client.channels.fetch(link[2]);
      if (channel?.guildId !== server) throw sorteioError('NOT_FOUND');
      const message = await channel.messages.fetch(link[3]);
      if (message?.author?.id !== client.user.id) throw sorteioError('NOT_FOUND');
      const component = message.components.flatMap(row => row.components).find(component => component.customId?.startsWith('sorteio_join:'));
      if (component) {
        const id = component.customId.split(':')[1];
        record = await service.bindMessage(id, server, channel.id, message.id);
        await syncQuietly(service, record);
      }
    }
    if (!record) throw sorteioError('NOT_FOUND');
    return record;
  }
  async function confirm(source, record, action) {
    const t = tradutor(source);
    const question = action === 'end' ? t('Encerrar este sorteio agora?') : action === 'cancel' ? t('Cancelar este sorteio sem vencedores?') : t('Sortear novos vencedores, excluindo todos os vencedores anteriores?');
    const payload = { ...safe, embeds: [createWarningEmbed(t('Confirmar ação no sorteio'), question)], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sorteio_${action}:${record.id}:${actor(source)}`).setLabel(t('Confirmar')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`sorteio_dismiss:${record.id}:${actor(source)}`).setLabel(t('Voltar')).setStyle(ButtonStyle.Secondary),
    )] };
    if (source.user) return replyInteraction(source, payload);
    return source.reply(payload);
  }
  async function syncQuietly(service, record) {
    try { await service.sync(record); }
    catch (error) { logger.warn(`[GIVEAWAY] Message update queued for retry: ${error.code || 'unavailable'}`); }
  }

  async function command(message, args = [], client) {
    const t = tradutor(message);
    try {
      await requireManager(message);
      const service = getService(client);
      const action = String(message.interaction?.options.getString('acao') || args[0] || 'criar').toLowerCase();
      const reference = message.interaction?.options.getString('id') || args[1];
      if (message.interaction && !['criar', 'novo', 'new'].includes(action) && !message.interaction.deferred && !message.interaction.replied) {
        await message.interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
      if (['criar', 'novo', 'new'].includes(action)) {
        const chosenChannel = message.interaction?.options.getChannel('canal')?.id || args.find(value => /^<#\d+>$/.test(value))?.replace(/[<#>]/g, '') || channelId(message);
        const everyone = message.interaction?.options.getBoolean('todos') || args.includes('@everyone');
        const roleId = everyone ? guildId(message) : message.interaction?.options.getRole('cargo')?.id || args.find(value => /^<@&\d+>$/.test(value))?.slice(3, -1) || null;
        const draft = await service.createDraft({ guildId: guildId(message), ownerId: actor(message), channelId: chosenChannel, roleId, locale: t.idioma });
        if (message.interaction) return message.interaction.showModal(buildSorteioForm(draft, t));
        return message.reply(buildSorteioPreview(draft));
      }
      if (['listar', 'lista', 'list'].includes(action)) {
        const records = await service.list(guildId(message));
        const page = Math.max(1, Number(message.interaction?.options.getInteger('pagina') || args[1]) || 1);
        const sorted = records.sort((a, b) => Number(['active', 'drawing', 'publishing'].includes(b.status)) - Number(['active', 'drawing', 'publishing'].includes(a.status)) || b.createdAt - a.createdAt);
        const slice = sorted.slice((page - 1) * 25, page * 25);
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(t('Sorteios do servidor'))
          .setDescription(slice.length ? t('Escolha um sorteio abaixo para gerenciar.') : t('Nenhum sorteio nesta página.'))
          .setFooter({ text: t('Página {pagina} de {total}', { pagina: page, total: Math.max(1, Math.ceil(records.length / 25)) }) });
        const components = slice.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('sorteio_list')
          .setPlaceholder(t('Selecione um sorteio')).addOptions(slice.map(record => ({ label: record.prize.slice(0, 100), value: record.id, description: `${sorteioStatusText(record, t)} • ${record.entries.length} • ${record.id}` }))))] : [];
        return message.reply({ ...safe, embeds: [embed], components });
      }
      const record = await resolveRecord(service, reference, guildId(message), client);
      if (['encerrar', 'end'].includes(action)) return confirm(message, record, 'end');
      if (['cancelar', 'cancel'].includes(action)) return confirm(message, record, 'cancel');
      if (['refazer', 'reroll'].includes(action)) return confirm(message, record, 'reroll');
      if (['gerenciar', 'ver', 'manage'].includes(action)) return message.reply(buildSorteioManagement(record, t));
      return message.reply({ ...safe, embeds: [createErrorEmbed(t('Uso do sorteio'), t('Use .sorteio para criar, .sorteio listar ou .sorteio gerenciar ID.'))] });
    } catch (error) {
      if (!error.sorteioCode) throw error;
      return message.reply({ ...safe, embeds: [sorteioErrorEmbed(error, message)] });
    }
  }

  async function interaction(source, client) {
    const t = tradutor(source);
    const service = getService(client);
    const [action, id, expectedActor] = source.customId.replace(/^sorteio_/, '').split(':');
    const server = guildId(source);
    if (!server) throw sorteioError('SERVER_ONLY');
    if (['join', 'leave'].includes(action)) {
      await source.deferReply({ flags: MessageFlags.Ephemeral });
      if (source.user.bot || source.message?.author?.id !== client.user.id) throw sorteioError('MESSAGE');
      let record = await service.get(id, server);
      if (record.channelId !== channelId(source)) throw sorteioError('MESSAGE');
      if (!record.messageId && record.status === 'publishing') record = await service.bindMessage(id, server, channelId(source), source.message.id);
      if (record.messageId !== source.message.id) throw sorteioError('MESSAGE');
      if (action === 'join') {
        const result = await service.join(id, server, actor(source));
        return replyInteraction(source, { embeds: [createSuccessEmbed(t('Participação no sorteio'), result.joined ? t('Você está participando. Boa sorte!') : t('Você já está participando; cada pessoa tem uma única chance.'))] });
      }
      const result = await service.leave(id, server, actor(source));
      return replyInteraction(source, { embeds: [createSuccessEmbed(t('Participação no sorteio'), result.left ? t('Sua participação foi removida.') : t('Você não estava participando deste sorteio.'))] });
    }

    await requireManager(source);
    if (action === 'list') {
      const record = await service.get(source.values[0], server);
      return replyInteraction(source, buildSorteioManagement(record, t));
    }
    if (['edit', 'appearance', 'target', 'styling', 'images'].includes(action)) {
      const draft = await service.getDraft(id, actor(source), server);
      if (draft.status !== 'editing') throw sorteioError('ALREADY_PUBLISHED');
      const modal = action === 'edit' ? buildSorteioForm(draft, t) : action === 'appearance' ? buildSorteioVisualForm(draft, t)
        : action === 'styling' ? buildSorteioTextForm(draft, t) : action === 'images' ? buildSorteioMediaForm(draft, t) : buildSorteioChannelForm(draft, t);
      return source.showModal(modal);
    }
    if (['form', 'visual', 'channel', 'texts', 'media'].includes(action)) {
      await deferPreview(source);
      let patch;
      if (action === 'form') patch = { prize: source.fields.getTextInputValue('prize'), description: source.fields.getTextInputValue('description'),
        winnerCount: Number(source.fields.getTextInputValue('winners')), durationMs: parseSorteioDuration(source.fields.getTextInputValue('duration')), audience: source.fields.getStringSelectValues('audience')[0] };
      if (action === 'visual') {
        const values = ['days', 'hours', 'minutes'].map(name => source.fields.getTextInputValue(name).trim());
        if (values.some(value => !/^\d+$/.test(value))) throw sorteioError('DURATION');
        patch = { durationMs: (Number(values[0]) * 1440 + Number(values[1]) * 60 + Number(values[2])) * 60000,
          color: source.fields.getTextInputValue('color').trim(), image: source.fields.getTextInputValue('image') };
      }
      if (action === 'channel') patch = { channelId: source.fields.getSelectedChannels('channel', true).first().id,
        roleId: source.fields.getStringSelectValues('mention_scope')[0] === 'everyone' ? server : source.fields.getSelectedRoles('mention_role', false)?.first()?.id || null };
      if (action === 'texts') patch = { title: source.fields.getTextInputValue('title'), description: source.fields.getTextInputValue('description'),
        footer: source.fields.getTextInputValue('footer'), joinLabel: source.fields.getTextInputValue('join_label'), leaveLabel: source.fields.getTextInputValue('leave_label') };
      if (action === 'media') patch = { color: source.fields.getTextInputValue('color'), image: source.fields.getTextInputValue('image'), thumbnail: source.fields.getTextInputValue('thumbnail') };
      const draft = await service.updateDraft(id, actor(source), server, patch);
      return replyInteraction(source, buildSorteioPreview(draft));
    }
    if (action === 'publish') {
      await deferPreview(source);
      const record = await service.publishDraft(id, actor(source), server);
      return replyInteraction(source, { content: '', embeds: [createSuccessEmbed(t('Sorteio publicado'), t('O sorteio foi publicado: {link}', { link: sorteioLink(record) }))], components: [] });
    }
    if (action === 'discard') {
      await deferPreview(source);
      await service.discardDraft(id, actor(source), server);
      return replyInteraction(source, { content: '', embeds: [createSuccessEmbed(t('Prévia descartada'), t('Nenhum sorteio foi publicado por esta prévia.'))], components: [] });
    }
    const record = await service.get(id, server);
    if (['askEnd', 'askCancel', 'askReroll'].includes(action)) return confirm(source, record, { askEnd: 'end', askCancel: 'cancel', askReroll: 'reroll' }[action]);
    if (expectedActor !== actor(source)) throw sorteioError('ACTION_OWNER');
    if (action === 'dismiss') return source.update({ ...buildSorteioManagement(record, t) });
    await source.deferReply({ flags: MessageFlags.Ephemeral });
    let updated;
    if (action === 'cancel') updated = await service.cancel(id, server);
    else if (action === 'end' || action === 'reroll') updated = await service.draw(id, server, { manual: true, reroll: action === 'reroll' });
    else throw sorteioError('NOT_FOUND');
    await syncQuietly(service, updated);
    return replyInteraction(source, buildSorteioManagement(updated, t));
  }
  return { command, interaction };
}

const handlers = createSorteioHandlers();
export const handleSorteioCommand = (...args) => handlers.command(...args);
export const handleSorteioInteraction = (...args) => handlers.interaction(...args);
