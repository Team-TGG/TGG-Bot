// apelidos customizados em json

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOM_NICKNAMES_FILE = path.join(__dirname, '..', 'customNicknames.json');

let customNicknames = {};

// carrega apelidos customizados
export async function loadCustomNicknames() {
  try {
    const data = await fs.readFile(CUSTOM_NICKNAMES_FILE, 'utf8');
    customNicknames = JSON.parse(data);
    console.log(`[CUSTOM NICKNAMES] Loaded ${Object.keys(customNicknames).length} custom nicknames`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      customNicknames = {};
      console.log('[CUSTOM NICKNAMES] arquivo não existe');
    } else {
      console.error('[CUSTOM NICKNAMES ERROR] Failed to load:', err.message);
      throw err;
    }
  }
}

// salva apelidos
export async function saveCustomNicknames() {
  try {
    await fs.writeFile(CUSTOM_NICKNAMES_FILE, JSON.stringify(customNicknames, null, 2), 'utf8');
    console.log('[CUSTOM NICKNAMES] Saved successfully');
  } catch (err) {
    console.error('[CUSTOM NICKNAMES ERROR] Failed to save:', err.message);
    throw err;
  }
}

export function getCustomNickname(discord_id) {
  return customNicknames[discord_id] || null;
}

export function setCustomNickname(discord_id, customName) {
  if (!customName || customName.trim() === '') {
    delete customNicknames[discord_id];
    console.log(`[CUSTOM NICKNAMES] Removed custom name for ${discord_id}`);
  } else {
    customNicknames[discord_id] = customName.trim();
    console.log(`[CUSTOM NICKNAMES] Set custom name for ${discord_id}: "${customName}"`);
  }
}

export function removeCustomNickname(discord_id) {
  delete customNicknames[discord_id];
  console.log(`[CUSTOM NICKNAMES] removido ${discord_id}`);
}

export function getAllCustomNicknames() {
  return { ...customNicknames };
}

export function clearAllCustomNicknames() {
  customNicknames = {};
  console.log('[CUSTOM NICKNAMES] limpo');
}
