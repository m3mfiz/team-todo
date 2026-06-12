import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { api, getSession, setOnSessionLost } from './api';
import type {
  CreateTaskInput,
  Session,
  TabKey,
  Task,
  UpdateTaskInput,
  User,
} from './types';
import { Login } from './components/Login';
import { TabBar } from './components/TabBar';
import { TaskList } from './components/TaskList';
import { AddSheet } from './components/AddSheet';
import { PlusIcon } from './icons';
import { todayKey } from './dates';

const TAB_TITLES: Record<TabKey, string> = {
  today: 'Сегодня',
  upcoming: 'Предстоящие',
  all: 'Все задачи',
  logbook: 'Журнал',
};

const COMPLETE_LINGER_MS = 1400;
const POLL_MS = 30000;

type Phase = 'loading' | 'login' | 'ready';

export default function App(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<TabKey>('today');
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'shared' | number>('all'); // admin client-side filter
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [leavingIds, setLeavingIds] = useState<Set<number>>(new Set());

  const leaveTimers = useRef<Map<number, number>>(new Map());

  // --- Session bootstrap -----------------------------------------------------
  const goToLogin = useCallback(() => {
    setUser(null);
    setUsers([]);
    setTasks([]);
    setPhase('login');
  }, []);

  useEffect(() => {
    setOnSessionLost(goToLogin);
    return () => setOnSessionLost(null);
  }, [goToLogin]);

  const loadInitial = useCallback(async (me: User) => {
    setUser(me);
    setPhase('ready');
    try {
      const [u, t] = await Promise.all([
        me.role === 'admin' ? api.users() : Promise.resolve<User[]>([]),
        api.tasks(),
      ]);
      if (me.role === 'admin') setUsers(u);
      setTasks(t);
    } catch {
      /* leave with whatever we have; session-lost handled by api */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stored = getSession();
    if (!stored) {
      setPhase('login');
      return;
    }
    void (async () => {
      try {
        const me = await api.me();
        if (!cancelled) await loadInitial(me);
      } catch {
        if (!cancelled) goToLogin();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadInitial, goToLogin]);

  // --- Task fetching / polling ----------------------------------------------
  const refetch = useCallback(async () => {
    try {
      const t = await api.tasks();
      setTasks(t);
    } catch {
      /* ignore; session-lost handled by api */
    }
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return;
    let timer: number | undefined;

    function schedule(): void {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          await refetch();
        }
        schedule();
      }, POLL_MS);
    }
    schedule();

    function onVisible(): void {
      if (document.visibilityState === 'visible') void refetch();
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, refetch]);

  // Clean up linger timers on unmount
  useEffect(() => {
    const timers = leaveTimers.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  // --- Mutations -------------------------------------------------------------
  const handleLogin = useCallback(
    (session: Session) => {
      void loadInitial(session.user);
    },
    [loadInitial],
  );

  const handleLogout = useCallback(async () => {
    await api.logout();
    goToLogin();
  }, [goToLogin]);

  // Optimistic complete with deferred removal + rollback on error.
  const handleComplete = useCallback(
    (task: Task) => {
      // mark leaving (keeps row visible & checked during linger)
      setLeavingIds((prev) => {
        const next = new Set(prev);
        next.add(task.id);
        return next;
      });
      if (expandedId === task.id) setExpandedId(null);

      // Fire PATCH immediately (optimistic).
      void (async () => {
        try {
          const updated = await api.updateTask(task.id, { status: 'done' });
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? updated : t)),
          );
        } catch {
          // rollback: drop from leaving so it stays open
          setLeavingIds((prev) => {
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
          return;
        }
      })();

      // After linger, drop the leaving flag so the (now done) task exits the open list.
      const timerId = window.setTimeout(() => {
        setLeavingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        leaveTimers.current.delete(task.id);
      }, COMPLETE_LINGER_MS);
      leaveTimers.current.set(task.id, timerId);
    },
    [expandedId],
  );

  const handleReopen = useCallback(async (task: Task) => {
    // optimistic
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: 'open', completedAt: null } : t,
      ),
    );
    try {
      const updated = await api.updateTask(task.id, { status: 'open' });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    }
  }, []);

  const handleSave = useCallback(
    async (id: number, input: UpdateTaskInput) => {
      const updated = await api.updateTask(id, input);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setExpandedId(null);
    },
    [],
  );

  const handleDelete = useCallback(async (id: number) => {
    const snapshot = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setExpandedId(null);
    try {
      await api.deleteTask(id);
    } catch {
      setTasks(snapshot);
    }
  }, [tasks]);

  const handleCreate = useCallback(
    async (input: CreateTaskInput) => {
      const created = await api.createTask(input);
      setTasks((prev) => [created, ...prev]);
    },
    [],
  );

  const toggleExpand = useCallback((id: number) => {
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  // --- Derived ---------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="boot">
        <div className="boot__spinner" aria-label="Загрузка" />
      </div>
    );
  }

  if (phase === 'login' || !user) {
    return <Login onSuccess={handleLogin} />;
  }

  const isAdmin = user.role === 'admin';
  const members = users;

  // Apply admin assignee filter (client-side).
  const visibleTasks =
    isAdmin && assigneeFilter !== 'all'
      ? tasks.filter((t) =>
          assigneeFilter === 'shared'
            ? t.assigneeId === null
            : t.assigneeId === assigneeFilter,
        )
      : tasks;

  const today = todayKey();
  const counts: Record<TabKey, number> = {
    today: visibleTasks.filter(
      (t) => t.status === 'open' && t.deadline !== null && t.deadline <= today,
    ).length,
    upcoming: visibleTasks.filter(
      (t) => t.status === 'open' && t.deadline !== null && t.deadline > today,
    ).length,
    all: visibleTasks.filter((t) => t.status === 'open').length,
    logbook: visibleTasks.filter((t) => t.status === 'done').length,
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header__top">
          <h1 className="header__title">{TAB_TITLES[tab]}</h1>
          <div className="header__user">
            <span className="header__name">{user.displayName}</span>
            <button
              type="button"
              className="header__logout"
              onClick={() => void handleLogout()}
            >
              Выйти
            </button>
          </div>
        </div>

        {isAdmin && (
          <div className="segmented" role="tablist" aria-label="Фильтр по исполнителю">
            <button
              type="button"
              className={`segmented__chip${assigneeFilter === 'all' ? ' segmented__chip--active' : ''}`}
              onClick={() => setAssigneeFilter('all')}
            >
              Все
            </button>
            <button
              type="button"
              className={`segmented__chip${assigneeFilter === 'shared' ? ' segmented__chip--active' : ''}`}
              onClick={() => setAssigneeFilter('shared')}
            >
              Всем
            </button>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`segmented__chip${assigneeFilter === m.id ? ' segmented__chip--active' : ''}`}
                onClick={() => setAssigneeFilter(m.id)}
              >
                {m.displayName}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="content">
        <TaskList
          tab={tab}
          tasks={visibleTasks}
          currentUser={user}
          members={members}
          expandedId={expandedId}
          leavingIds={leavingIds}
          onToggleExpand={toggleExpand}
          onComplete={handleComplete}
          onReopen={handleReopen}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      </main>

      <button
        type="button"
        className="fab"
        onClick={() => setShowAdd(true)}
        aria-label="Новая задача"
      >
        <PlusIcon size={28} />
      </button>

      <TabBar active={tab} onChange={setTab} counts={counts} />

      {showAdd && (
        <AddSheet
          currentUser={user}
          members={members}
          onClose={() => setShowAdd(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
