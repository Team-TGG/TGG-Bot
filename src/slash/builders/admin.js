import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

// Comandos de administração e moderação (23)
// default_member_permissions: moderadores+ enxergam. Checks internos de DB/hierarchy permanecem.
const MOD_DEFAULT_PERMS = PermissionFlagsBits.ModerateMembers;

export const adminCommands = [
  // ── Sincronização ──
  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Sincroniza membros que precisam ser atualizados (ranks + ELO)')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('sync-all')
    .setDescription('Sincronização completa de todos os membros (ranks + ELO)')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('sync-nick')
    .setDescription('Sincroniza apelidos com o clan Brawlhalla')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('refresh-cache')
    .setDescription('Atualiza o cache da guilda Brawlhalla')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  // ── Moderação ──
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Aplica um aviso a um usuário')
    .addUserOption(o => o.setName('usuario').setDescription('@user ou ID').setRequired(true))
    .addStringOption(o => o.setName('duracao').setDescription('Duração (ex: 1h, 30m, 2d, 1M). Omitir = permanente'))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo do aviso'))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Remove o último aviso de um usuário')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('edit-warn')
    .setDescription('Edita o motivo de um aviso específico')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .addIntegerOption(o => o.setName('numero').setDescription('Número do aviso (1, 2, 3...)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('motivo').setDescription('Novo motivo').setRequired(true))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('warns')
    .setDescription('Lista avisos de um usuário (ou todos, se admin)')
    .addUserOption(o => o.setName('usuario').setDescription('@user (admin pode ver todos se omitido)')),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Silencia um usuário por uma duração')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .addStringOption(o => o.setName('duracao').setDescription('Duração (ex: 1h, 30m, 2d)').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo do mute'))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove o silenciamento de um usuário')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bane um usuário (com confirmação)')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo do ban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsa um usuário da guilda')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo do kick'))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  // ── Inativos ──
  new SlashCommandBuilder()
    .setName('inac-all')
    .setDescription('Aplica cargo de inativo a todos os jogadores flagged')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('inac-list')
    .setDescription('Lista paginada de jogadores inativos')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('justificativas')
    .setDescription('Lista justificativas de inatividade de um usuário')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  // ── Missões ──
  new SlashCommandBuilder()
    .setName('concluida')
    .setDescription('Marca a missão semanal N como concluída')
    .addIntegerOption(o => o.setName('numero').setDescription('Número da missão (1-4)').setRequired(true).setMinValue(1).setMaxValue(4))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('cadastrarmissao')
    .setDescription('Cadastra uma nova missão semanal (máx 4/semana)')
    .addStringOption(o => o.setName('nome').setDescription('Nome da missão').setRequired(true))
    .addStringOption(o => o.setName('dica').setDescription('Dica/observação').setRequired(true))
    .addIntegerOption(o => o.setName('objetivo').setDescription('Objetivo numérico').setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  // ── Usuários ──
  new SlashCommandBuilder()
    .setName('entrou')
    .setDescription('Adiciona/reativa usuário e troca para cargo Recruta')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .addStringOption(o => o.setName('brawlhalla_id').setDescription('ID Brawlhalla do usuário').setRequired(true))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('escrever')
    .setDescription('Cria um embed via formulário (campos: título, descrição, cor, imagem, thumbnail)')
    .addChannelOption(o => o.setName('canal').setDescription('Canal destino (padrão: atual)')),

  // ── Tickets ──
  new SlashCommandBuilder()
    .setName('organize-tickets')
    .setDescription('Reordena/renomeia canais de ticket pelo número')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('abrir-tickets')
    .setDescription('Abre visibilidade dos canais de ticket e anuncia')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('fechar-tickets')
    .setDescription('Fecha visibilidade dos canais de ticket')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  // ── Misc ──
  new SlashCommandBuilder()
    .setName('resumo')
    .setDescription('Resumo/overview com navegação')
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),

  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Visão de staff sobre um membro: entrada, saídas, jogos, guild points e justificativas')
    .addUserOption(o => o.setName('usuario').setDescription('Membro a escanear').setRequired(true))
    .setDefaultMemberPermissions(MOD_DEFAULT_PERMS),
];
