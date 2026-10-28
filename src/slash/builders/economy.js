import { SlashCommandBuilder } from 'discord.js';

// Comandos da economia TGG-Coins (14)
export const economyCommands = [
  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Recompensa diária com streak (MVP/VIP com bônus)'),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Mostra seu saldo de coins (+ tickets de evento)')
    .addUserOption(o => o.setName('usuario').setDescription('Ver saldo de outro usuário')),

  new SlashCommandBuilder()
    .setName('historico')
    .setDescription('Histórico paginado de transações')
    .addUserOption(o => o.setName('usuario').setDescription('Ver histórico de outro usuário')),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Placar de coins / total / tickets com toggle'),

  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Loja TGG-Coins com categorias (Geral, Cargos, Serviços, Coaching)'),

  new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Compra um item da loja pela posição')
    .addIntegerOption(o => o.setName('posicao').setDescription('Número do item na loja').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Equipar/remover cores e itens adquiridos'),

  new SlashCommandBuilder()
    .setName('conquistas')
    .setDescription('Conquistas semanais e histórico')
    .addUserOption(o => o.setName('usuario').setDescription('Ver conquistas de outro usuário')),

  new SlashCommandBuilder()
    .setName('streak')
    .setDescription('Mostra seu streak diário e próximo bônus'),

  new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('Inicia um quiz (uma vez por usuário, com recompensa)'),

  new SlashCommandBuilder()
    .setName('add-account')
    .setDescription('Vincula uma conta alt Brawlhalla à sua conta principal')
    .addStringOption(o => o.setName('brawlhalla_id').setDescription('ID Brawlhalla da alt').setRequired(true)),

  // ── Admin de economia ──
  new SlashCommandBuilder()
    .setName('addcoins')
    .setDescription('Concede coins a um usuário (Administrator ou acima)')
    .addUserOption(o => o.setName('usuario').setDescription('@user').setRequired(true))
    .addStringOption(o => o.setName('tipo').setDescription('Tipo da transação (GIFT, CHAMPIONSHIP…): escolha um existente ou digite um novo').setRequired(true).setAutocomplete(true).setMaxLength(100))
    .addStringOption(o => o.setName('descricao').setDescription('Descrição da transação').setRequired(true))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addprovider')
    .setDescription('Adiciona um prestador de serviço a um item da loja')
    .addIntegerOption(o => o.setName('posicao').setDescription('Posição do item').setRequired(true).setMinValue(1))
    .addUserOption(o => o.setName('usuario').setDescription('@user prestador').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removeprovider')
    .setDescription('Remove um prestador de serviço de um item da loja')
    .addIntegerOption(o => o.setName('posicao').setDescription('Posição do item').setRequired(true).setMinValue(1))
    .addUserOption(o => o.setName('usuario').setDescription('@user prestador').setRequired(true)),
];
