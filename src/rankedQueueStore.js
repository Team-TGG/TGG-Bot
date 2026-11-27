import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyQueueState, validQueueState, queueError } from './services/rankedQueueService.js';

/** Cache privado independente dos sorteios; apenas um processo do monitor escreve nele. */
export function createRankedQueueStore(path) {
  return {
    async read() {
      try {
        const state = JSON.parse(await readFile(path, 'utf8'));
        if (!validQueueState(state)) throw queueError('STORAGE');
        return state;
      } catch (error) {
        if (error.code === 'ENOENT') return emptyQueueState();
        throw queueError('STORAGE');
      }
    },
    async write(state) {
      if (!validQueueState(state)) throw queueError('STORAGE');
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
      let file;
      try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(JSON.stringify(state), 'utf8');
        await file.sync();
        await file.close(); file = null;
        await rename(temporary, path);
      } finally {
        await file?.close().catch(() => {});
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    },
  };
}
