import { publicCommands } from './public.js';
import { adminCommands } from './admin.js';
import { economyCommands } from './economy.js';

// 12 públicos + 23 admin/mod + 14 economia = 49 comandos (limite guild: 100)
export const allSlashCommands = [
  ...publicCommands,
  ...adminCommands,
  ...economyCommands,
];
