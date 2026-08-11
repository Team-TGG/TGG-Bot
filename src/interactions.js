import { Events } from 'discord.js';
import { commands } from './commands.js';
import { runAsSlash } from '../utils/slashAdapter.js';
import { checkInteractionChannelPermission, isAdmin } from '../utils/permissions.js';
import { STAFF_ROLE_IDS } from '../config/index.js';
import { createErrorEmbed } from '../utils/discordUtils.js';
import { handleEscreverModalSubmit } from './admin.js';
import { handleJustificativaButton, handleJustificativaHistorico } from './public.js';

// Rate limit (mesmo do messageCreate anterior): 5s por usuário, staff isento.
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 5000;

async function handleChatInput(interaction, client) {
  const commandName = interaction.commandName;
  const handler = commands[commandName];

  if (!handler) {
    return interaction.reply({
      embeds: [createErrorEmbed('Comando Desconhecido', `Não há handler para \`/${commandName}\`.`)],
      ephemeral: true,
    }).catch(() => {});
  }

  // Permissão de canal (allowlist em app code)
  const allowed = await checkInteractionChannelPermission(interaction);
  if (!allowed) return;

  // Rate limit
  const userId = interaction.user.id;
  const isStaff = interaction.member?.roles?.cache?.some(
    role => Object.values(STAFF_ROLE_IDS).includes(role.id)
  );

  if (!isStaff) {
    const now = Date.now();
    const last = rateLimitMap.get(userId);
    if (last && now - last < RATE_LIMIT_MS) {
      const remaining = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
      return interaction.reply({
        embeds: [createErrorEmbed('Calma lá!', `Aguarde **${remaining}s** para usar outro comando.`)],
        ephemeral: true,
      }).catch(() => {});
    }
    rateLimitMap.set(userId, now);
  }

  try {
    await runAsSlash(handler, interaction, client);
  } catch (err) {
    console.error('[Slash Command Error]', err);
    const payload = {
      embeds: [createErrorEmbed('Erro Interno', `Um erro inesperado ocorreu: ${err.message}`)],
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
    }
  }
}

export function registerInteractionHandler(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleChatInput(interaction, client);
      return;
    }

    // Modal submits: roteados por prefix no customId
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('escrever_modal')) {
        await handleEscreverModalSubmit(interaction, client);
      }
      return;
    }

    // Aba de justificativas do pedido: vem antes da decisão porque `handleJustificativaButton`
    // trata como recusa tudo que não é `aprovar`.
    if (interaction.isButton() && /^justificativa_(hist|histpg)_/.test(interaction.customId)) {
      try {
        await handleJustificativaHistorico(interaction, client);
      } catch (err) {
        console.error('[JUSTIFICATIVA] falha ao abrir o histórico:', err);
        const payload = {
          embeds: [createErrorEmbed('Erro Interno', `Não consegui buscar o histórico: ${err.message}`)],
          ephemeral: true,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    // Botões de aprovação da justificativa: roteados por prefixo, como os modais.
    //
    // É a exceção à regra de collector no handler. A staff pode levar horas para decidir e o
    // collector morre no primeiro restart; o estado do pedido vive na tabela, então o botão
    // precisa continuar funcionando depois de deploy.
    if (interaction.isButton() && interaction.customId.startsWith('justificativa_')) {
      try {
        await handleJustificativaButton(interaction, client);
      } catch (err) {
        console.error('[JUSTIFICATIVA] falha ao decidir:', err);
        const payload = {
          embeds: [createErrorEmbed('Erro Interno', `Não consegui registrar a decisão: ${err.message}`)],
          ephemeral: true,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    // Os demais botões/menus continuam via createMessageComponentCollector nas mensagens de reply.
    // Não roteamos aqui — cada handler dono do collector continua ouvindo.
  });
}
