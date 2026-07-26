import { REST, Routes } from 'discord.js';
import { discord as discordConfig } from '../../config/index.js';
import { allSlashCommands } from './builders/index.js';

// PUT sobrescreve todos os comandos de guild de uma vez — Discord recalcula o diff.
export async function registerGuildCommands() {
  const { applicationId, guildId, token } = discordConfig;

  if (!applicationId || !guildId || !token) {
    throw new Error('applicationId/guildId/token faltando em config');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  const body = allSlashCommands.map(cmd => cmd.toJSON());

  const data = await rest.put(
    Routes.applicationGuildCommands(applicationId, guildId),
    { body },
  );

  console.log(`[Slash] ${data.length} comandos registrados na guild ${guildId}`);
  return data;
}
