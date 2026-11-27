import { resolve } from 'node:path';
import { apiFetch } from './brawlhallaHttp.js';
import { createRankedQueueStore } from '../rankedQueueStore.js';
import { createRankedQueueService, QUEUE_POLL_MS, QUEUE_REGION, QUEUE_MODES, QUEUE_PAGES, queueError } from './rankedQueueService.js';

let service, started = false;

export function getRankedQueueService() {
  if (!process.env.BRAWLHALLA_API_KEY) throw queueError('CONFIG');
  service ||= createRankedQueueService({
    store: createRankedQueueStore(resolve(process.cwd(), 'data', 'ranked-queue.json')),
    fetchPage: async (mode, page) => {
      if (!QUEUE_MODES.includes(mode) || !Number.isInteger(page) || page < 1 || page > QUEUE_PAGES) throw queueError('MODE');
      if (!process.env.BRAWLHALLA_API_KEY) throw queueError('CONFIG');
      const url = new URL(`https://api.brawlhalla.com/rankings/${mode}/${QUEUE_REGION}/${page}`);
      url.searchParams.set('api_key', process.env.BRAWLHALLA_API_KEY);
      return apiFetch(url, { background: true });
    },
  });
  return service;
}

export async function iniciarRankedQueue() {
  if (started) return;
  if (!process.env.BRAWLHALLA_API_KEY) throw queueError('CONFIG');
  const monitor = getRankedQueueService();
  await monitor.initialize();
  started = true;
  const poll = () => monitor.poll().then(async () => {
    const views = await Promise.all(QUEUE_MODES.map(mode => monitor.snapshot(mode)));
    console.log(`[QUEUE] BRZ snapshots updated: ${views.map(view => `${view.mode}=${view.status}`).join(', ')}.`);
  }).catch(() => console.warn('[QUEUE] Monitor unavailable; previous data preserved.'));
  const timer = setInterval(poll, QUEUE_POLL_MS);
  timer.unref?.();
  void poll();
  console.log('[QUEUE] Ranked activity monitor started.');
}
