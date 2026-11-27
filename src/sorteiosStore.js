import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const empty = () => ({ version: 1, drafts: {}, giveaways: {} });
const storageError = (code, cause) => Object.assign(new Error(code, { cause }), { sorteioCode: 'UNAVAILABLE' });

async function atomicWrite(path, state) {
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
}

function validState(state) {
  if (!state || state.version !== 1 || !state.drafts || !state.giveaways ||
    Array.isArray(state.drafts) || Array.isArray(state.giveaways)) return false;
  return Object.entries(state.drafts).every(([id, value]) => value?.id === id && value.ownerId && value.guildId) &&
    Object.entries(state.giveaways).every(([id, value]) => value?.id === id && value.guildId && value.channelId &&
      ['publishing', 'active', 'drawing', 'ended', 'cancelled'].includes(value.status) &&
      Array.isArray(value.entries) && Array.isArray(value.rounds) && Number.isFinite(value.endsAt));
}

/** Um processo PM2; todas as mutações são serializadas e o arquivo só é trocado após fsync. */
export function createSorteiosStore(path, { write = atomicWrite } = {}) {
  let tail = Promise.resolve();
  const serialize = task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
  async function load() {
    let data;
    try { data = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return empty(); throw storageError('SORTEIO_STORAGE_UNAVAILABLE', error); }
    if (!validState(data)) throw storageError('SORTEIO_STORAGE_INVALID');
    return data;
  }
  return {
    read: () => serialize(load),
    transaction: update => serialize(async () => {
      const state = await load();
      const result = await update(state);
      if (!validState(state)) throw storageError('SORTEIO_STORAGE_INVALID');
      try { await write(path, state); } catch (error) { throw storageError('SORTEIO_STORAGE_UNAVAILABLE', error); }
      return structuredClone(result);
    }),
  };
}
