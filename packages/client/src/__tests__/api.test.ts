import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session, Task } from '../types';

// NOTE: api.ts reads localStorage at import time and holds module-level state
// (session + refreshInFlight). Each test resets modules and re-imports, after
// installing a fresh localStorage stub PRE-SEEDED with a session and a fresh
// fetch mock. There is intentionally NO static `import '../api'` here.

const SESSION_KEY = 'team-todo-session';

function makeSession(accessToken: string): Session {
  return {
    accessToken,
    refreshToken: 'refresh-old',
    user: {
      id: 1,
      username: 'alice',
      displayName: 'Alice',
      role: 'admin',
    },
  };
}

function installLocalStorage(seed: Record<string, string>): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  const stub = {
    getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string): void => {
      store.set(k, String(v));
    },
    removeItem: (k: string): void => {
      store.delete(k);
    },
    clear: (): void => {
      store.clear();
    },
  };
  (globalThis as unknown as { localStorage: typeof stub }).localStorage = stub;
  return store;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

async function loadApi() {
  vi.resetModules();
  return import('../api');
}

let store: Map<string, string>;

beforeEach(() => {
  store = installLocalStorage({
    [SESSION_KEY]: JSON.stringify(makeSession('access-old')),
  });
  (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi.fn();
});

describe('authorized request', () => {
  it('sets Authorization: Bearer <token> on a GET', async () => {
    const mod = await loadApi();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [] as Task[]));

    await mod.api.tasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tasks');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer access-old');
  });
});

describe('401 -> single refresh + retry', () => {
  it('refreshes once then retries the original request with the new token', async () => {
    const mod = await loadApi();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve(jsonResponse(200, makeSession('access-new')));
      }
      // first /api/tasks -> 401, second -> 200
      const tasksCalls = fetchMock.mock.calls.filter(
        (c: unknown[]) => c[0] === '/api/tasks',
      ).length;
      return Promise.resolve(
        tasksCalls <= 1 ? jsonResponse(401, {}) : jsonResponse(200, []),
      );
    });

    await mod.api.tasks();

    const refreshCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => c[0] === '/api/auth/refresh',
    );
    const tasksCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => c[0] === '/api/tasks',
    );
    expect(refreshCalls).toHaveLength(1);
    expect(tasksCalls).toHaveLength(2);
    // refresh body carries the original refreshToken
    expect(JSON.parse(refreshCalls[0][1].body)).toEqual({
      refreshToken: 'refresh-old',
    });
    // retry used the NEW access token
    expect(tasksCalls[1][1].headers.Authorization).toBe('Bearer access-new');
  });
});

describe('single-flight refresh', () => {
  it('two parallel 401s trigger exactly ONE refresh, both retried', async () => {
    const mod = await loadApi();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    let resolveRefresh!: (r: Response) => void;
    const refreshGate = new Promise<Response>((r) => {
      resolveRefresh = r;
    });
    const tasksSeen = new Set<string>();

    fetchMock.mockImplementation((url: string, init: { headers: Record<string, string> }) => {
      if (url === '/api/auth/refresh') {
        return refreshGate;
      }
      // Distinguish first vs retry by the auth token used.
      const token = init.headers.Authorization;
      if (token === 'Bearer access-old') {
        return Promise.resolve(jsonResponse(401, {}));
      }
      tasksSeen.add(url);
      return Promise.resolve(jsonResponse(200, []));
    });

    const p1 = mod.api.tasks();
    const p2 = mod.api.users();
    // Let both initial 401s settle and both enter refreshSession before resolving.
    await Promise.resolve();
    await Promise.resolve();
    resolveRefresh(jsonResponse(200, makeSession('access-new')));

    await Promise.all([p1, p2]);

    const refreshCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => c[0] === '/api/auth/refresh',
    );
    expect(refreshCalls).toHaveLength(1);
    // both endpoints retried with the new token
    expect(tasksSeen.has('/api/tasks')).toBe(true);
    expect(tasksSeen.has('/api/users')).toBe(true);
  });
});

describe('refresh failure', () => {
  it('clears the session, fires onSessionLost, and getSession() becomes null', async () => {
    const mod = await loadApi();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const onLost = vi.fn();
    mod.setOnSessionLost(onLost);

    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve(jsonResponse(401, {}));
      }
      return Promise.resolve(jsonResponse(401, {}));
    });

    await expect(mod.api.tasks()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(mod.getSession()).toBeNull();
    expect(store.has(SESSION_KEY)).toBe(false);
  });
});

describe('non-401 error', () => {
  it('throws ApiError with the server message and does NOT refresh', async () => {
    const mod = await loadApi();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { message: 'Некорректные данные' }),
    );

    await expect(mod.api.tasks()).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Некорректные данные',
    });

    const refreshCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => c[0] === '/api/auth/refresh',
    );
    expect(refreshCalls).toHaveLength(0);
  });
});
