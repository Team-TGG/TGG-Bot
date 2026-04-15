import cron from 'node-cron';
import { discord as discordConfig } from '../../config/index.js';
import { processBirthdays, removeBirthdayRole } from '../services/birthdayService.js';

export function startCronJobs(client, services) {
  const {
    fetchBrawlhallaClanData,
    runSync,
    runEloSync,
    syncNicknames,
    getUsers,
    getUsersWithElo,
    getAllUsers,
    getAllUsersWithElo
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

  // Aniversários - 00:00: remove cargos do dia anterior e adiciona novos
  cron.schedule('0 0 * * *', async () => {
    try {
      await removeBirthdayRole(client);
      await processBirthdays(client);
    } catch (err) {
      console.error('[CRON ERROR - Birthdays]', err);
    }
  }, {
    timezone: 'America/Sao_Paulo'
  });

  // Sincronização completa de todos os membros - 3:00 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Starting FULL sync...');

    try {

      await fetchBrawlhallaClanData();

      const users = await getAllUsers();
      await runSync(client, users);

      const usersWithElo = await getAllUsersWithElo();
      await runEloSync(client, usersWithElo);

      console.log('[CRON] FULL sync completed.');

    } catch (err) {
      console.error('[CRON ERROR - FULL SYNC]', err);
    }
  }, {
    timezone: 'America/Sao_Paulo'
  });

}