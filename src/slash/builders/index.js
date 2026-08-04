import { publicCommands } from './public.js';
import { adminCommands } from './admin.js';
import { economyCommands } from './economy.js';

// Públicos + admin/mod + economia. Limite do Discord: 100 por guild.
// Contagem real: node .claude/skills/checar/check.mjs (não deixe número fixo em comentário)
export const allSlashCommands = [
  ...publicCommands,
  ...adminCommands,
  ...economyCommands,
];
