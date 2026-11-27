import { resolve } from 'node:path';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createSorteiosStore } from '../sorteiosStore.js';
import { createSorteiosService, sorteioError } from './sorteiosService.js';
import { getUserByDiscordId, getSorteioMembrosAtivos } from '../db.js';
import { buildSorteioMessage } from '../sorteiosViews.js';

let service;
let started = false;

export function getSorteiosService(client) {
  if (service) return service;
  const getChannel = async record => {
    let channel;
    try { channel = await client.channels.fetch(record.channelId); }
    catch (error) { if ([10003, 50001, 50013].includes(error.code)) throw sorteioError('CHANNEL_PERMISSIONS'); throw error; }
    if (!channel || channel.guildId !== record.guildId || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw sorteioError('CHANNEL');
    return channel;
  };
  const validateChannel = async record => {
    const channel = await getChannel(record);
    const [bot, organizer] = await Promise.all([channel.guild.members.fetchMe(), channel.guild.members.fetch(record.ownerId)]);
    const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
    if (!channel.permissionsFor(bot)?.has(required) || !channel.permissionsFor(organizer)?.has(PermissionFlagsBits.ViewChannel)) throw sorteioError('CHANNEL_PERMISSIONS');
    return channel;
  };
  service = createSorteiosService({
    store: createSorteiosStore(resolve(process.cwd(), 'data', 'sorteios.json')),
    validateChannel,
    publish: async record => (await validateChannel(record)).send({ ...buildSorteioMessage(record), nonce: record.id.replaceAll('-', '').slice(0, 24), enforceNonce: true }),
    findPublished: async record => {
      const channel = await getChannel(record);
      const messages = await channel.messages.fetch({ limit: 100 });
      return messages.find(message => message.author.id === client.user.id && message.components.some(row => row.components.some(component => component.customId === `sorteio_join:${record.id}`))) || null;
    },
    updateMessage: async record => {
      const message = await (await getChannel(record)).messages.fetch(record.messageId);
      if (message.author.id !== client.user.id) throw sorteioError('MESSAGE');
      await message.edit(buildSorteioMessage(record));
    },
    canEnter: async (record, userId) => {
      const guild = await client.guilds.fetch(record.guildId);
      let member;
      try { member = await guild.members.fetch({ user: userId, force: true }); }
      catch (error) { if (error.code === 10007) return false; throw error; }
      if (!member || member.user.bot) return false;
      if (record.audience === 'all') return true;
      const user = await getUserByDiscordId(userId);
      return Boolean(user?.active && user.brawlhalla_id);
    },
    eligibleEntries: async record => {
      const guild = await client.guilds.fetch(record.guildId);
      const current = new Set();
      for (let offset = 0; offset < record.entries.length; offset += 100) {
        const members = await guild.members.fetch({ user: record.entries.slice(offset, offset + 100), withPresences: false, time: 20000 });
        members.forEach(member => { if (!member.user.bot) current.add(member.id); });
      }
      if (record.audience === 'members') {
        const active = await getSorteioMembrosAtivos([...current]);
        return [...current].filter(id => active.has(id));
      }
      return [...current];
    },
  });
  return service;
}

export async function iniciarSorteios(client) {
  if (started) return;
  const giveaways = getSorteiosService(client);
  // Primeiro acesso valida o arquivo; arquivo corrompido não é substituído por um vazio.
  await giveaways.list(client.guilds.cache.first()?.id || '');
  started = true;
  const tick = () => giveaways.tick().catch(() => console.warn('[GIVEAWAY] Scheduler unavailable; saved state preserved.'));
  const timer = setInterval(tick, 10000);
  timer.unref?.();
  void tick();
  console.log('[GIVEAWAY] Persistent scheduler started.');
}
