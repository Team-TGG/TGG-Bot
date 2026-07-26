import {
  ApplicationCommandOptionType,
  Collection,
} from 'discord.js';

// Ponytail: handlers continuam com assinatura (message, args, client).
// Adapter monta message-shim a partir de interaction.options. reply() retorna Message real
// (fetchReply: true) pra collectors e .edit() funcionarem nativos.

function buildArgsAndContent(interaction) {
  const args = [];
  const parts = ['/' + interaction.commandName];
  const users = new Collection();
  const members = new Collection();
  const channels = new Collection();
  const roles = new Collection();
  const attachments = new Collection();

  for (const opt of interaction.options.data) {
    let arg;
    switch (opt.type) {
      case ApplicationCommandOptionType.User:
        arg = `<@${opt.value}>`;
        parts.push(`<@${opt.user?.id || opt.value}>`);
        if (opt.user) users.set(opt.user.id, opt.user);
        // Popula members também (usado por handleAddProvider/Remove)
        try {
          const m = interaction.options.getMember(opt.name);
          if (m) members.set(m.id, m);
        } catch { /* getMember pode falhar se membro não estiver em cache */ }
        break;
      case ApplicationCommandOptionType.Channel:
        arg = `<#${opt.value}>`;
        parts.push(`<#${opt.value}>`);
        if (opt.channel) channels.set(opt.channel.id, opt.channel);
        break;
      case ApplicationCommandOptionType.Role:
        arg = `<@&${opt.value}>`;
        parts.push(`<@&${opt.value}>`);
        if (opt.role) roles.set(opt.role.id, opt.role);
        break;
      case ApplicationCommandOptionType.Attachment:
        arg = opt.attachment?.url || '';
        parts.push(arg);
        if (opt.attachment) attachments.set(opt.attachment.id, opt.attachment);
        break;
      case ApplicationCommandOptionType.Mentionable:
        arg = `<@${opt.value}>`;
        parts.push(`<@${opt.value}>`);
        break;
      default:
        arg = String(opt.value);
        parts.push(arg);
    }
    args.push(arg);
  }

  return {
    args,
    content: parts.join(' '),
    mentions: { users, members, channels, roles },
    attachments,
  };
}

function buildMessageShim(interaction, content, mentions, attachments) {
  const replyCount = { n: 0 };

  return {
    // identify como mensagem do Discord p/ libs que checam instanceof (não usamos aqui)
    author: interaction.user,
    member: interaction.member,
    channel: interaction.channel,
    channelId: interaction.channelId,
    guild: interaction.guild,
    guildId: interaction.guildId,
    content,
    attachments,
    mentions,
    interaction, // exposto p/ handlers especiais lerem options tipadas
    createdAt: new Date(),
    createdTimestamp: Date.now(),
    deletable: false,
    // reply segue o fluxo interaction.reply → followUp. fetchReply:true p/ ter Message real.
    async reply(payload) {
      replyCount.n += 1;
      if (replyCount.n === 1 && !interaction.deferred && !interaction.replied) {
        return interaction.reply({ ...payload, fetchReply: true });
      }
      return interaction.followUp({ ...payload, fetchReply: true });
    },
    async delete() {
      return;
    },
    async react() {
      return;
    },
  };
}

export async function runAsSlash(handler, interaction, client) {
  const { args, content, mentions, attachments } = buildArgsAndContent(interaction);
  const messageShim = buildMessageShim(interaction, content, mentions, attachments);
  await handler(messageShim, args, client);
}

// Expõe opções em formato nome→valor p/ handlers especiais (escrever, addcoins, etc.)
export function getOptionsMap(interaction) {
  const map = {};
  for (const opt of interaction.options.data) {
    map[opt.name] = opt;
  }
  return map;
}
