// Painel do .cargo: o dono de um cargo personalizado cria, edita, dá e tira o cargo.
//
// Tudo é roteado pelo prefixo `cargoperso_` em interactions.js, sem collector: o painel fica no
// canal e o botão precisa continuar valendo depois de um restart. A posse é conferida no banco a
// cada clique, então não importa quem abriu o painel — só o dono consegue usar os botões dele.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, FileUploadBuilder, LabelBuilder,
  MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from 'discord.js';
import { createErrorEmbed, createSuccessEmbed } from '../../utils/discordUtils.js';
import * as tggCoins from '../tggCoins.js';
import {
  getCargosDoDono, getCargoPorRoleId, getCredito, lerCamposDoModal, criarCargo, editarCargo, darEEquipar, tirarDoMembro,
} from '../cargosPersonalizados.js';

// O painel tem uma linha por cargo; o Discord aceita 5 linhas de componentes por mensagem
const MAX_LINHAS = 5;

const hex = (n) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`;

export function botaoCriarCargo(creditoId) {
  return new ButtonBuilder()
    .setCustomId(`cargoperso_criar:${creditoId}`)
    .setLabel('Criar meu cargo')
    .setEmoji('🎨')
    .setStyle(ButtonStyle.Success);
}

function modalDoCargo(customId, titulo, role = null) {
  const texto = (id, estilo = TextInputStyle.Short) => new TextInputBuilder().setCustomId(id).setStyle(estilo);

  const nome = texto('nome').setMaxLength(100).setRequired(true);
  const cor1 = texto('cor1').setMinLength(6).setMaxLength(7).setPlaceholder('#FF8800').setRequired(true);
  const cor2 = texto('cor2').setMinLength(6).setMaxLength(7).setPlaceholder('Deixe vazio para cor única').setRequired(false);

  if (role) {
    nome.setValue(role.name);
    cor1.setValue(hex(role.colors.primaryColor));
    if (role.colors.secondaryColor != null) cor2.setValue(hex(role.colors.secondaryColor));
  }

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(titulo)
    .addLabelComponents(
      new LabelBuilder().setLabel('Nome do cargo').setTextInputComponent(nome),
      new LabelBuilder().setLabel('Cor').setDescription('Hexadecimal, tipo #FF8800').setTextInputComponent(cor1),
      new LabelBuilder().setLabel('Segunda cor (degradê)').setDescription('Opcional: preencha para o cargo ficar em degradê').setTextInputComponent(cor2),
      new LabelBuilder()
        .setLabel('Ícone')
        .setDescription(role ? 'Opcional: só envie se quiser trocar o atual. Até 256 KB.' : 'Opcional: imagem de até 256 KB')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('icone').setRequired(false).setMaxValues(1)),
    );
}

// ---- .cargo ----
export async function handleCargoPersonalizado(message) {
  const linhas = await getCargosDoDono(message.author.id);

  if (!linhas.length) {
    return message.reply({
      embeds: [createErrorEmbed('Sem cargo personalizado', 'Você não tem nenhum cargo personalizado. Compre um na `.shop`.')]
    });
  }

  const creditos = linhas.filter(l => !l.role_id);
  const cargos = linhas
    .filter(l => l.role_id)
    .map(l => message.guild.roles.cache.get(l.role_id))
    .filter(Boolean);

  const descricao = [
    ...cargos.map(r => `• ${r}`),
    ...creditos.map(() => '• *Cargo ainda não criado*'),
  ];

  const componentes = [
    ...creditos.map(c => new ActionRowBuilder().addComponents(botaoCriarCargo(c.id))),
    ...cargos.map(r => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cargoperso_editar:${r.id}`).setLabel(`Editar ${r.name}`.slice(0, 80)).setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cargoperso_dar:${r.id}`).setLabel('Dar').setEmoji('➕').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cargoperso_tirar:${r.id}`).setLabel('Tirar').setEmoji('➖').setStyle(ButtonStyle.Danger),
    )),
  ];

  const sobra = componentes.length - MAX_LINHAS;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎨 Seus cargos personalizados')
    .setDescription(descricao.join('\n') + (sobra > 0 ? `\n\n… e mais ${sobra}, que não cabem nos botões. Fale com a staff.` : ''))
    .setFooter({ text: 'Dar coloca o cargo no .inv da pessoa e já equipa. Tirar remove dos dois. Para equipar ou desequipar o seu, use .inv' });

  return message.reply({ embeds: [embed], components: componentes.slice(0, MAX_LINHAS) });
}

// ---- Interações (botões, menus e modais com prefixo cargoperso_) ----
export async function handleCargoPersonalizadoInteracao(interaction) {
  const [acao, alvo] = interaction.customId.replace('cargoperso_', '').split(':');
  const efemero = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

  // Criar: o crédito tem que ser de quem clicou e não pode ter sido usado
  if (acao === 'criar' || acao === 'mcriar') {
    const credito = await getCredito(alvo);
    if (!credito || credito.owner_discord_id !== interaction.user.id) {
      return interaction.reply(efemero(createErrorEmbed('Não é seu', 'Só quem comprou pode criar este cargo.')));
    }
    if (credito.role_id) {
      return interaction.reply(efemero(createErrorEmbed('Já criado', `Este cargo já existe: <@&${credito.role_id}>. Use \`.cargo\` para editar.`)));
    }

    if (acao === 'criar') {
      return interaction.showModal(modalDoCargo(`cargoperso_mcriar:${credito.id}`, 'Criar cargo personalizado'));
    }

    const campos = lerCamposDoModal(interaction);
    if (campos.erro) return interaction.reply(efemero(createErrorEmbed('Não deu para criar', `${campos.erro}\nClique em **Criar meu cargo** de novo.`)));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const role = await criarCargo(member, credito, campos);

    if (!role) return interaction.editReply({ embeds: [createErrorEmbed('Já criado', 'Este crédito já foi usado.')] });

    return interaction.editReply({
      embeds: [createSuccessEmbed('Cargo criado!', `${role} já está equipado e no seu \`.inv\`.\n\n` +
        '• **Equipar ou desequipar:** `.inv`\n' +
        '• **Editar, dar ou tirar de alguém:** `.cargo`')]
    });
  }

  // Daqui para baixo o alvo é um cargo que já existe, e só o dono mexe
  const linha = await getCargoPorRoleId(alvo);
  const role = interaction.guild.roles.cache.get(alvo);

  if (!linha || linha.owner_discord_id !== interaction.user.id) {
    return interaction.reply(efemero(createErrorEmbed('Não é seu', 'Só o dono do cargo pode fazer isso.')));
  }
  if (!role) {
    return interaction.reply(efemero(createErrorEmbed('Cargo não encontrado', 'Esse cargo não existe mais no servidor. Fale com a staff.')));
  }

  if (acao === 'editar') {
    return interaction.showModal(modalDoCargo(`cargoperso_meditar:${role.id}`, 'Editar cargo personalizado', role));
  }

  if (acao === 'meditar') {
    const campos = lerCamposDoModal(interaction);
    if (campos.erro) return interaction.reply(efemero(createErrorEmbed('Não deu para editar', campos.erro)));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await editarCargo(role, campos, interaction.user.username);
    return interaction.editReply({ embeds: [createSuccessEmbed('Cargo atualizado!', `${role} foi atualizado.`)] });
  }

  if (acao === 'dar') {
    const menu = new UserSelectMenuBuilder()
      .setCustomId(`cargoperso_udar:${role.id}`)
      .setPlaceholder('Escolha quem vai receber')
      .setMinValues(1)
      .setMaxValues(10);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`Para quem você quer dar ${role}?`)],
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (acao === 'udar') {
    await interaction.deferUpdate();
    const resultado = [];

    for (const id of interaction.values) {
      const member = await interaction.guild.members.fetch(id).catch(() => null);
      if (!member || member.user.bot) {
        resultado.push(`❌ <@${id}> não está no servidor`);
        continue;
      }
      await darEEquipar(member, role.id);
      resultado.push(`✅ ${member}`);
    }

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`${role.name} entregue`).setDescription(resultado.join('\n'))],
      components: [],
    });
  }

  if (acao === 'tirar') {
    // Quem tem no inventário, menos o próprio dono: tirar de si mesmo é pelo .inv
    const donos = (await tggCoins.getInventoryHolders(role.id)).filter(id => id !== interaction.user.id);

    if (!donos.length) {
      return interaction.reply(efemero(createErrorEmbed('Ninguém para tirar', `Só você tem ${role}.`)));
    }

    // O menu aceita 25 opções; acima disso a lista vem dita, não cortada calada
    const opcoes = await Promise.all(donos.slice(0, 25).map(async id => {
      const m = interaction.guild.members.cache.get(id) ?? await interaction.guild.members.fetch(id).catch(() => null);
      return { label: (m?.displayName ?? `Saiu do servidor (${id})`).slice(0, 100), value: id };
    }));

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`cargoperso_stirar:${role.id}`)
      .setPlaceholder('Escolha de quem tirar')
      .setMinValues(1)
      .setMaxValues(opcoes.length)
      .addOptions(opcoes);

    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(
        `De quem você quer tirar ${role}?` + (donos.length > 25 ? `\n\nMostrando 25 de ${donos.length}.` : '')
      )],
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (acao === 'stirar') {
    await interaction.deferUpdate();
    for (const id of interaction.values) {
      await tirarDoMembro(interaction.guild, id, role.id);
    }
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`${role.name} retirado`).setDescription(interaction.values.map(id => `➖ <@${id}>`).join('\n'))],
      components: [],
    });
  }
}
