import cron from 'node-cron';
import { discord as discordConfig } from '../../config/index.js';
import { processBirthdays, removeBirthdayRole } from '../services/birthdayService.js';
import { publishMotd } from '../services/motdService.js';
import { registrarMissoesDaSemana } from '../services/weeklyMissionsService.js';
import { registrarDueloDaSemana } from '../services/guildDuelService.js';
import { trocarMvpsDaSemana } from '../services/weeklyMvpService.js';
import { inativarSemana } from '../services/weeklyInactiveService.js';

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

  // MOTD - 00:00
  cron.schedule('0 6 * * *', async () => {
    await publishMotd(client);
  }, {
    timezone: 'America/Sao_Paulo'
  });

  // Missões da semana - quinta 06:00, quando a semana vira
  cron.schedule('0 6 * * 4', async () => {
    try {
      await registrarMissoesDaSemana(client);
    } catch (err) {
      console.error('[CRON ERROR - Missoes]', err);
    }
  }, {
    timezone: 'America/Sao_Paulo'
  });

  // MVPs da semana - quarta 06:00, quando as missões fecham. O valor lido é o fechamento da semana.
  cron.schedule('0 6 * * 3', async () => {
    try {
      await trocarMvpsDaSemana(client);
    } catch (err) {
      console.error('[CRON ERROR - MVP]', err);
    }
  }, {
    timezone: 'America/Sao_Paulo'
  });

  // Inativos da semana - quarta 06:10. Roda depois do MVP de propósito: os dois medem a mesma
  // semana, e deixar o MVP na frente evita as duas rotinas disputando a API na mesma virada.
  cron.schedule('10 6 * * 3', async () => {
    try {
      await inativarSemana(client);
    } catch (err) {
      console.error('[CRON ERROR - Inativos]', err);
    }
  }, {
    timezone: 'America/Sao_Paulo'
  });

  // Duelo da semana - quarta 07:00. As missões fecham 06:00 e na quarta não dá mais para farmar, então o valor lido aqui é o fechamento da semana e a linha de base da seguinte.
  cron.schedule('0 7 * * 3', async () => {
    try {
      await registrarDueloDaSemana(client);
    } catch (err) {
      console.error('[CRON ERROR - Duelo]', err);
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
