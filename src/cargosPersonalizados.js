// cargosPersonalizados.js - cargos personalizados da loja (tabela tgg_coins_custom_roles)
import { getClient } from './db.js';
import * as tggCoins from './tggCoins.js';
import { cargosPersonalizados as config } from '../config/index.js';
import { motivoDeBloqueio } from './services/filtroDeTexto.js';

// Limite do Discord para ícone de cargo
export const TAMANHO_MAXIMO_ICONE = 256 * 1024;

export async function getCargosDoDono(discordId) {
  const { data, error } = await getClient()
    .from('tgg_coins_custom_roles')
    .select('*')
    .eq('owner_discord_id', String(discordId))
    .order('criado_em');

  if (error) throw error;
  return data ?? [];
}

export async function getCargoPorRoleId(roleId) {
  const { data, error } = await getClient()
    .from('tgg_coins_custom_roles')
    .select('*')
    .eq('role_id', String(roleId))
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getCredito(id) {
  const { data, error } = await getClient()
    .from('tgg_coins_custom_roles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// A compra vira crédito antes de existir cargo: fechar o modal sem querer não perde as moedas
export async function criarCredito(discordId) {
  const { data, error } = await getClient()
    .from('tgg_coins_custom_roles')
    .insert({ owner_discord_id: String(discordId) })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Condicionado a role_id nulo: dois envios do mesmo modal não gastam o crédito duas vezes
async function vincularCargo(creditoId, roleId) {
  const { data, error } = await getClient()
    .from('tgg_coins_custom_roles')
    .update({ role_id: String(roleId), cargo_criado_em: new Date().toISOString() })
    .eq('id', creditoId)
    .is('role_id', null)
    .select();

  if (error) throw error;
  return data.length > 0;
}

/**
 * Lê e valida os campos do modal. Devolve { erro } ou { nome, cores, icone }.
 * Cor única vira cargo de cor sólida; duas viram degradê.
 */
export function lerCamposDoModal(interaction) {
  const nome = interaction.fields.getTextInputValue('nome').trim();
  const corTexto = [interaction.fields.getTextInputValue('cor1'), interaction.fields.getTextInputValue('cor2')]
    .map(c => (c ?? '').trim())
    .filter(Boolean);
  const icone = interaction.fields.getUploadedFiles('icone')?.first() ?? null;

  if (!nome) return { erro: 'O nome não pode ser vazio.' };
  if (motivoDeBloqueio(nome) === 'link') return { erro: 'O nome não pode ter link.' };

  const cores = [];
  for (const texto of corTexto) {
    const hex = texto.replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) {
      return { erro: `\`${texto}\` não é uma cor válida. Use o formato hexadecimal, tipo \`#FF8800\`.` };
    }
    cores.push(parseInt(hex, 16));
  }
  if (!cores.length) return { erro: 'Informe pelo menos uma cor.' };

  if (icone) {
    if (!icone.contentType?.startsWith('image/')) return { erro: 'O ícone precisa ser uma imagem (PNG, JPG ou GIF).' };
    if (icone.size > TAMANHO_MAXIMO_ICONE) return { erro: 'O ícone pode ter no máximo 256 KB (limite do Discord).' };
  }

  return { nome, cores, icone };
}

function coresDoDiscord(cores) {
  return { primaryColor: cores[0], secondaryColor: cores[1] ?? null };
}

/**
 * Equipa o cargo como as cores do .inv: tira as outras cores do inventário que a pessoa está
 * usando e põe só esta. Garante a linha no inventário antes.
 */
export async function darEEquipar(member, roleId) {
  const inventario = (await tggCoins.getInventory(member.id)).map(i => String(i.role_id));

  if (!inventario.includes(String(roleId))) {
    await tggCoins.addInventoryItem(member.id, roleId);
  }

  const outras = inventario.filter(id => id !== String(roleId) && member.roles.cache.has(id));
  if (outras.length) await member.roles.remove(outras, 'Equipou cargo personalizado');
  await member.roles.add(roleId, 'Equipou cargo personalizado');
}

export async function tirarDoMembro(guild, discordId, roleId) {
  await tggCoins.removeInventoryItem(discordId, roleId);
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Dono do cargo personalizado retirou');
}

/**
 * Cria o cargo logo abaixo do separador `=- Custom -=`, gasta o crédito e equipa no dono.
 * Devolve o cargo criado, ou null se o crédito já tinha sido usado.
 */
export async function criarCargo(member, credito, { nome, cores, icone }) {
  const guild = member.guild;

  const role = await guild.roles.create({
    name: nome,
    colors: coresDoDiscord(cores),
    icon: icone?.url ?? null,
    permissions: [],
    mentionable: false,
    reason: `Cargo personalizado de ${member.user.username}`,
  });

  if (!(await vincularCargo(credito.id, role.id))) {
    await role.delete('Crédito já usado por outro envio do modal').catch(() => {});
    return null;
  }

  // O cargo nasce na base da lista. Lendo o separador depois da criação, a posição já conta com ele:
  // subir o cargo para (separador - 1) o deixa logo abaixo, e o separador fica onde estava.
  const separador = await guild.roles.fetch(config.separadorRoleId, { force: true }).catch(() => null);
  if (separador) {
    await role.setPosition(separador.position - 1).catch(err =>
      console.warn('[CARGO PERSONALIZADO] não consegui posicionar abaixo do separador:', err.message));
  }

  await darEEquipar(member, role.id);
  return role;
}

export async function editarCargo(role, { nome, cores, icone }, quem) {
  return role.edit({
    name: nome,
    colors: coresDoDiscord(cores),
    // Sem arquivo novo o ícone atual fica; o modal não tem como mostrar o que já está lá
    ...(icone ? { icon: icone.url } : {}),
    reason: `Editado pelo dono (${quem})`,
  });
}
