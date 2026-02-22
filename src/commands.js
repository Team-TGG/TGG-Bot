/**
 * Slash command definitions and registration.
 * Only allowed user IDs can run these (checked in interaction handler).
 */

import { REST, Routes } from 'discord.js';

const GUILD_ROLES_CMD = {
  name: 'sync-guild-roles',
  description: 'Sync guild rank roles (recruit/member/officer) from the database. Allowed users only.',
};

const ELO_ROLES_CMD = {
  name: 'sync-elo-roles',
  description: 'Sync ELO roles from player_elo_missions (initial_elo_1v1). Allowed users only.',
};

const GUILD_ACTIVITY_CMD = {
  name: 'guild-activity',
  description: 'Test',
};

const COMMANDS = [GUILD_ROLES_CMD, ELO_ROLES_CMD, GUILD_ACTIVITY_CMD];

/**
 * Register slash commands for the guild (so they appear immediately).
 */
export async function registerCommands(clientId, guildId, token) {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS });
  console.log(`Registered ${COMMANDS.length} slash commands in guild ${guildId}`);
}

export { COMMANDS, GUILD_ROLES_CMD, ELO_ROLES_CMD, GUILD_ACTIVITY_CMD };
