export const MENSAGEM_API_FORA_DO_AR =
  'Não foi possível consultar a API do Brawlhalla no momento. Tente novamente em alguns instantes.';

export function createApiFetch({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 10_000,
  attempts = 2,
  cooldownMs = 30_000,
  maxConcurrent = 4,
  logger = console,
} = {}) {
  const limits = {
    v1: { max: 2000, window: 5 * 60_000, log: [], active: 0, queue: [], retryAt: 0 },
    v0: { max: 180, window: 15 * 60_000, log: [], active: 0, queue: [], retryAt: 0 },
  };
  const pending = new Map();

  function unavailable(version, status = 503) {
    const err = new Error(`A API ${version} do Brawlhalla está indisponível no momento. Tente novamente em alguns instantes.`);
    err.status = status;
    err.apiForaDoAr = true;
    err.apiVersion = version;
    return err;
  }

  async function acquire(limit) {
    if (limit.active < maxConcurrent) limit.active++;
    else await new Promise(resolve => limit.queue.push(resolve));
    return () => {
      const next = limit.queue.shift();
      if (next) next();
      else limit.active--;
    };
  }

  async function request(url, version, limit) {
    const release = await acquire(limit);
    let timer;
    try {
      if (limit.retryAt > now()) throw unavailable(version);
      while (true) {
        while (limit.log.length && now() - limit.log[0] >= limit.window) limit.log.shift();
        if (limit.log.length < limit.max) break;
        const delay = Math.max(1, limit.window - (now() - limit.log[0]) + 50);
        logger.warn(`[Brawlhalla] Rate limit ${version} atingido, aguardando ${Math.ceil(delay / 1000)}s`);
        await wait(delay);
      }
      limit.log.push(now());
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'TGG-Bot' },
          signal: controller.signal,
        });
      } catch {
        throw unavailable(version);
      }

      if (res.status >= 500) {
        await res.body?.cancel().catch(() => {});
        logger.warn(`[Brawlhalla] API unavailable (${res.status}) at ${url.origin}${url.pathname}`);
        throw unavailable(version, res.status);
      }
      if (!res.ok) {
        // Respostas de erro podem repetir a URL autenticada; só status e caminho vão para o log.
        await res.body?.cancel().catch(() => {});
        const err = new Error(`API ${version}: HTTP ${res.status} ao consultar ${url.pathname}.`);
        err.status = res.status;
        throw err;
      }
      let data;
      try { data = await res.json(); }
      catch { throw unavailable(version); }
      limit.retryAt = 0;
      return data;
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  async function execute(url, version, limit) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (limit.retryAt > now()) throw unavailable(version);
      try { return await request(url, version, limit); }
      catch (err) {
        if (!err.apiForaDoAr) throw err;
        if (attempt + 1 === attempts) {
          // A queda da v1 não consome a cota da API antiga nem prende cada comando em novas tentativas.
          if (version === 'v1') limit.retryAt = now() + cooldownMs;
          throw err;
        }
        await wait(500 * (attempt + 1));
      }
    }
  }

  return function apiFetch(input) {
    const url = new URL(input);
    const version = url.pathname.startsWith('/v1/') ? 'v1' : 'v0';
    const key = url.href;
    if (pending.has(key)) return pending.get(key);
    const task = execute(url, version, limits[version]).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

export const apiFetch = createApiFetch();
