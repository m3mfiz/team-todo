import type {
  AdminCreateUserInput,
  CreateTaskInput,
  Session,
  Task,
  UpdateTaskInput,
  User,
} from './types';

const SESSION_KEY = 'team-todo-session';

let session: Session | null = loadSession();
let onSessionLost: (() => void) | null = null;

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (parsed && parsed.accessToken && parsed.refreshToken && parsed.user) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function persist(next: Session | null): void {
  session = next;
  if (next) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

export function getSession(): Session | null {
  return session;
}

export function setOnSessionLost(cb: (() => void) | null): void {
  onSessionLost = cb;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export { ApiError };

// --- Single-flight refresh ---------------------------------------------------
let refreshInFlight: Promise<Session | null> | null = null;

async function doRefresh(): Promise<Session | null> {
  const current = session;
  if (!current) return null;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as Session;
    persist(data);
    return data;
  } catch {
    return null;
  }
}

function refreshSession(): Promise<Session | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// --- Core request with 401 -> single refresh + retry -------------------------
interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function rawRequest(
  path: string,
  token: string | null,
  options: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.auth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const useAuth = options.auth !== false;
  let res = await rawRequest(path, session?.accessToken ?? null, {
    ...options,
    auth: useAuth,
  });

  if (res.status === 401 && useAuth && session) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await rawRequest(path, refreshed.accessToken, {
        ...options,
        auth: true,
      });
    } else {
      persist(null);
      onSessionLost?.();
      throw new ApiError(401, 'Сессия истекла');
    }
  }

  if (!res.ok) {
    if (res.status === 401 && useAuth) {
      persist(null);
      onSessionLost?.();
    }
    let message = `Ошибка ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// --- Public API --------------------------------------------------------------
export const api = {
  async login(username: string, password: string): Promise<Session> {
    const data = await request<Session>('/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    persist(data);
    return data;
  },

  async logout(): Promise<void> {
    const current = session;
    persist(null);
    if (current) {
      try {
        await request<void>('/auth/logout', {
          method: 'POST',
          body: { refreshToken: current.refreshToken },
          auth: false,
        });
      } catch {
        /* ignore network errors on logout */
      }
    }
  },

  me(): Promise<User> {
    return request<User>('/auth/me');
  },

  users(): Promise<User[]> {
    return request<User[]>('/users');
  },

  tasks(): Promise<Task[]> {
    return request<Task[]>('/tasks');
  },

  createTask(input: CreateTaskInput): Promise<Task> {
    return request<Task>('/tasks', { method: 'POST', body: input });
  },

  updateTask(id: number, input: UpdateTaskInput): Promise<Task> {
    return request<Task>(`/tasks/${id}`, { method: 'PATCH', body: input });
  },

  deleteTask(id: number): Promise<void> {
    return request<void>(`/tasks/${id}`, { method: 'DELETE' });
  },

  // --- Admin: user management ---
  adminCreateUser(input: AdminCreateUserInput): Promise<User> {
    return request<User>('/admin/users', { method: 'POST', body: input });
  },

  adminDeleteUser(id: number): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' });
  },

  adminSetPassword(id: number, password: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/admin/users/${id}/password`, {
      method: 'POST',
      body: { password },
    });
  },

  vapidPublicKey(): Promise<{ publicKey: string | null }> {
    return request<{ publicKey: string | null }>('/push/vapid-public-key');
  },

  pushSubscribe(input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }): Promise<{ ok: true }> {
    return request<{ ok: true }>('/push/subscribe', {
      method: 'POST',
      body: input,
    });
  },

  pushUnsubscribe(endpoint: string): Promise<{ ok: true }> {
    return request<{ ok: true }>('/push/unsubscribe', {
      method: 'POST',
      body: { endpoint },
    });
  },
};
