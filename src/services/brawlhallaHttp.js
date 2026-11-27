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
  v0MinIntervalMs = 500,
  logger = console,
} = {}) {
  const limits = {
    v1: { max: 2000, window: 5 * 60_000, log: [], active: 0, queue: [] },
    v0: { max: 180, window: 15 * 60_000, log: [], active: 0, queue: [] },
  };
  const pending = new Map();
  const retriesAfter = new Map();
  let nextV0Slot = 0;
  let v0StartTail = Promise.resolve();

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

  async function request(url, version, limit, background) {
    const deferBackground = () => background && version === 'v0' && limit.log.filter(time => now() - time < limit.window).length >= limit.max - 60;
    const deferredQuota = () => Object.assign(new Error('Background API quota reserved for commands.'), { status: 429, apiQuotaDeferred: true });
    if (deferBackground()) throw deferredQuota();
    const release = await acquire(limit);
    let timer;
    try {
      if ((retriesAfter.get(url.pathname) || 0) > now()) throw unavailable(version);
      while (true) {
        while (limit.log.length && now() - limit.log[0] >= limit.window) limit.log.shift();
        if (deferBackground()) throw deferredQuota();
        if (limit.log.length < limit.max) break;
        const delay = Math.max(1, limit.window - (now() - limit.log[0]) + 50);
        logger.warn(`[Brawlhalla] Rate limit ${version} atingido, aguardando ${Math.ceil(delay / 1000)}s`);
        await wait(delay);
      }
      limit.log.push(now());
      if (version === 'v0' && v0MinIntervalMs > 0) {
        const slot = v0StartTail.then(async () => {
          const delay = Math.max(0, nextV0Slot - now());
          if (delay) await wait(delay);
          nextV0Slot = now() + v0MinIntervalMs;
        });
        v0StartTail = slot.catch(() => {});
        await slot;
      }
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
      retriesAfter.delete(url.pathname);
      return data;
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  async function execute(url, version, limit, background) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if ((retriesAfter.get(url.pathname) || 0) > now()) throw unavailable(version);
      try { return await request(url, version, limit, background); }
      catch (err) {
        if (!err.apiForaDoAr) throw err;
        if (attempt + 1 === attempts) {
          // Uma rota indisponível não bloqueia outras fontes válidas da mesma versão.
          if (version === 'v1') retriesAfter.set(url.pathname, now() + cooldownMs);
          throw err;
        }
        await wait(500 * (attempt + 1));
      }
    }
  }

  return function apiFetch(input, { background = false } = {}) {
    const url = new URL(input);
    const version = url.pathname.startsWith('/v1/') ? 'v1' : 'v0';
    const key = `${background ? 'background:' : ''}${url.href}`;
    if (pending.has(key)) return pending.get(key);
    const task = execute(url, version, limits[version], background).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

export const apiFetch = createApiFetch();
