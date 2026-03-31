import cron from 'node-cron';
import { discord as discordConfig } from '../../config/index.js';

export function startCronJobs(client, services) {

  const {
    fetchBrawlhallaClanData,
    runSync,
    runEloSync,
    syncNicknames,
    getUsers,
    getUsersWithElo
  } = services;

  // Executa a cada hora os comandos de cache, sync e sync-nick
  cron.schedule('0 * * * *', async () => {

    console.log('[CRON] Starting job...');

    try {

      await fetchBrawlhallaClanData();

      const users = await getUsers();
      await runSync(client, users);

      const usersWithElo = await getUsersWithElo();
      await runEloSync(client, usersWithElo);

      await syncNicknames(client, discordConfig.guildId);

      console.log('[CRON] Job completed successfully.');

    } catch (err) {
      console.error('[CRON ERROR]', err);
    }

  });

}