/**
 * Custom Discord Nicknames Storage
 * Stores custom Discord nickname overrides in JSON format
 * Structure: { "discord_id": "customDiscordName" }
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOM_NICKNAMES_FILE = path.join(__dirname, '..', 'customNicknames.json');

let customNicknames = {};

/**
 * Load custom nicknames from JSON file
 */
export async function loadCustomNicknames() {
  try {
    const data = await fs.readFile(CUSTOM_NICKNAMES_FILE, 'utf8');
    customNicknames = JSON.parse(data);
    console.log(`[CUSTOM NICKNAMES] Loaded ${Object.keys(customNicknames).length} custom nicknames`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet, that's fine
      customNicknames = {};
      console.log('[CUSTOM NICKNAMES] No custom nicknames file found, starting fresh');
    } else {
      console.error('[CUSTOM NICKNAMES ERROR] Failed to load:', err.message);
      throw err;
    }
  }
}

/**
 * Save custom nicknames to JSON file
 */
export async function saveCustomNicknames() {
  try {
    await fs.writeFile(CUSTOM_NICKNAMES_FILE, JSON.stringify(customNicknames, null, 2), 'utf8');
    console.log('[CUSTOM NICKNAMES] Saved successfully');
  } catch (err) {
    console.error('[CUSTOM NICKNAMES ERROR] Failed to save:', err.message);
    throw err;
  }
}

/**
 * Get custom nickname for a Discord user
 * @param {string} discord_id - The Discord user ID
 * @returns {string|null} Custom nickname or null if none set
 */
export function getCustomNickname(discord_id) {
  return customNicknames[discord_id] || null;
}

/**
 * Set custom nickname for a Discord user
 * @param {string} discord_id - The Discord user ID
 * @param {string} customName - The custom name to set
 */
export function setCustomNickname(discord_id, customName) {
  if (!customName || customName.trim() === '') {
    delete customNicknames[discord_id];
    console.log(`[CUSTOM NICKNAMES] Removed custom name for ${discord_id}`);
  } else {
    customNicknames[discord_id] = customName.trim();
    console.log(`[CUSTOM NICKNAMES] Set custom name for ${discord_id}: "${customName}"`);
  }
}

/**
 * Remove custom nickname for a Discord user
 * @param {string} discord_id - The Discord user ID
 */
export function removeCustomNickname(discord_id) {
  delete customNicknames[discord_id];
  console.log(`[CUSTOM NICKNAMES] Removed custom name for ${discord_id}`);
}

/**
 * Get all custom nicknames
 * @returns {Object} Object of discord_id -> customName
 */
export function getAllCustomNicknames() {
  return { ...customNicknames };
}

/**
 * Clear all custom nicknames
 */
export function clearAllCustomNicknames() {
  customNicknames = {};
  console.log('[CUSTOM NICKNAMES] Cleared all custom names');
}
