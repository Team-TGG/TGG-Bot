import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';

// Comandos públicos
export const publicCommands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Mostra a lista de comandos disponíveis'),

  new SlashCommandBuilder()
    .setName('regras')
    .setDescription('Mostra as regras da guilda'),

  new SlashCommandBuilder()
    .setName('motd')
    .setDescription('Salva uma mensagem para ser sorteada no site (1x por semana)')
    .addStringOption(o => o.setName('mensagem').setDescription('A mensagem (máx 255 chars)').setRequired(true).setMaxLength(255)),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Traz seus status atualizados do jogo')
    .addUserOption(o => o.setName('usuario').setDescription('Ver status de outro usuário')),

  new SlashCommandBuilder()
    .setName('guild')
    .setDescription('Ver informações da guilda Team TGG')
    .addStringOption(o => o.setName('id').setDescription('ID alternativo de guild/clan')),

  new SlashCommandBuilder()
    .setName('missoes')
    .setDescription('Mostra as missões da semana atual'),

  new SlashCommandBuilder()
    .setName('active')
    .setDescription('Justifica inatividade (própria) ou remove inatividade (admin)')
    .addUserOption(o => o.setName('usuario').setDescription('Remover inatividade de outro usuário (admin)'))
    .addStringOption(o => o.setName('justificativa').setDescription('Sua justificativa (mínimo 15 caracteres)').setMinLength(15)),

  new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Registra seu aniversário para parabéns no dia')
    .addStringOption(o => o.setName('data').setDescription('Data no formato DD/MM').setRequired(true)),

  new SlashCommandBuilder()
    .setName('corrigir-id')
    .setDescription('Vincula o ID da sua conta principal quando está jogando com alt')
    .addStringOption(o => o.setName('main_id').setDescription('ID da conta principal Brawlhalla').setRequired(true)),

  new SlashCommandBuilder()
    .setName('games')
    .setDescription('Quantidade de jogos na semana/mês/season')
    .addUserOption(o => o.setName('usuario').setDescription('Ver jogos de outro usuário')),

  new SlashCommandBuilder()
    .setName('redes')
    .setDescription('Verificar as redes sociais da TGG'),

  new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Informações do duelo atual contra outra guilda'),

  new SlashCommandBuilder()
    .setName('video-guilda')
    .setDescription('Vídeo explicando como funciona a guilda'),
];
