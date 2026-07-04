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
import { UsersScreen } from './components/UsersScreen';
import { PlusIcon, SearchIcon } from './icons';
import { todayKey } from './dates';
import { toViewTasks } from './grouping';
import {
  ensurePushSubscription,
  getPushSupport,
  requestAndSubscribe,
  unsubscribePush,
} from './push';

const TAB_TITLES: Record<TabKey, string> = {
  today: 'Сегодня',
  upcoming: 'Предстоящие',
  all: 'Все задачи',
  logbook: 'Журнал',
};

const COMPLETE_LINGER_MS = 1400;
const POLL_MS = 30000;
const PUSH_DISMISSED_KEY = 'team-todo-push-dismissed';

type Phase = 'loading' | 'login' | 'ready';
type View = 'tasks' | 'users';

export default function App(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<TabKey>('today');
  const [view, setView] = useState<View>('tasks');
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'shared' | number>('all'); // admin client-side filter
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [leavingIds, setLeavingIds] = useState<Set<number>>(new Set());
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const leaveTimers = useRef<Map<number, number>>(new Map());

  // --- Session bootstrap -----------------------------------------------------
  const goToLogin = useCallback(() => {
    setUser(null);
    setUsers([]);
    setTasks([]);
    setView('tasks');
    setLoadError(false);
    setShowSearch(false);
    setSearchQuery('');
    setPhase('login');
  }, []);

  useEffect(() => {
    setOnSessionLost(goToLogin);
    return () => setOnSessionLost(null);
  }, [goToLogin]);

  const loadInitial = useCallback(async (me: User) => {
    setUser(me);
    setPhase('ready');
    // /api/users is open to any authenticated user — the roster is needed
    // by every role now (Progress Pie totals for shared tasks), not just
    // the admin's user-management screen. It's fetched independently: tasks
    // are the critical path (loadError gates on them alone), and the Pie
    // already degrades to the plain «Всем» chip when the roster is empty.
    void api.users().then(setUsers).catch(() => undefined);
    try {
      const t = await api.tasks();
      setTasks(t);
      setLoadError(false);
    } catch {
      /* session-lost handled by api; anything else is a load failure */
      setLoadError(true);
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
      setLoadError(false);
    } catch {
      /* ignore; session-lost handled by api */
    }
  }, []);

  const refetchUsers = useCallback(async () => {
    try {
      const u = await api.users();
      setUsers(u);
      // a deleted user may have been the active assignee filter — reset it
      setAssigneeFilter((cur) =>
        typeof cur === 'number' && !u.some((m) => m.id === cur) ? 'all' : cur,
      );
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
          await Promise.all([refetch(), refetchUsers()]);
        }
        schedule();
      }, POLL_MS);
    }
    schedule();

    function onVisible(): void {
      if (document.visibilityState === 'visible') {
        void refetch();
        void refetchUsers();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, refetch, refetchUsers]);

  // --- Push notifications setup ---------------------------------------------
  useEffect(() => {
    if (phase !== 'ready') return;
    const support = getPushSupport();
    if (support === 'granted') {
      void ensurePushSubscription();
      setShowPushBanner(false);
    } else if (support === 'default') {
      const dismissed = localStorage.getItem(PUSH_DISMISSED_KEY) === '1';
      setShowPushBanner(!dismissed);
    } else {
      setShowPushBanner(false);
    }
  }, [phase]);

  const handleEnablePush = useCallback(async () => {
    const result = await requestAndSubscribe();
    if (result !== 'granted') {
      // denied / unsupported / disabled — stop nagging.
      localStorage.setItem(PUSH_DISMISSED_KEY, '1');
    }
    setShowPushBanner(false);
  }, []);

  const dismissPushBanner = useCallback(() => {
    localStorage.setItem(PUSH_DISMISSED_KEY, '1');
    setShowPushBanner(false);
  }, []);

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
    await unsubscribePush();
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

      // For a member completing a shared task, optimistically record HIS mark
      // (myCompleted + completions) instead of the global status — the global
      // status flips only when everyone is done (server decides).
      const me = user;
      const sharedAsMember =
        me !== null && me.role === 'member' && task.assigneeId === null;
      const snapshot = tasks.find((t) => t.id === task.id);
      if (sharedAsMember && me) {
        const nowIso = new Date().toISOString();
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== task.id) return t;
            const others = (t.completions ?? []).filter(
              (c) => c.userId !== me.id,
            );
            const completions = [
              ...others,
              {
                userId: me.id,
                displayName: me.displayName,
                completedAt: nowIso,
              },
            ].sort((a, b) =>
              a.displayName.localeCompare(b.displayName, 'ru'),
            );
            return { ...t, myCompleted: true, completions };
          }),
        );
      }

      // The leaving flag drops only when BOTH the linger elapsed (animation
      // floor) AND the PATCH succeeded — a slow response must not flicker the
      // row back into the open list before the server confirms.
      let lingerElapsed = false;
      let patched = false;
      const dropLeaving = (): void =>
        setLeavingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      const finish = (): void => {
        if (lingerElapsed && patched) dropLeaving();
      };

      // Fire PATCH immediately (optimistic).
      void (async () => {
        try {
          const updated = await api.updateTask(task.id, { status: 'done' });
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? updated : t)),
          );
        } catch {
          // rollback: restore optimistic mark and drop from leaving immediately
          if (sharedAsMember && snapshot) {
            setTasks((prev) =>
              prev.map((t) => (t.id === task.id ? snapshot : t)),
            );
          }
          const pending = leaveTimers.current.get(task.id);
          if (pending) {
            window.clearTimeout(pending);
            leaveTimers.current.delete(task.id);
          }
          dropLeaving();
          return;
        }
        patched = true;
        finish();
      })();

      const timerId = window.setTimeout(() => {
        lingerElapsed = true;
        leaveTimers.current.delete(task.id);
        finish();
      }, COMPLETE_LINGER_MS);
      leaveTimers.current.set(task.id, timerId);
    },
    [expandedId, tasks, user],
  );

  const handleReopen = useCallback(
    async (task: Task) => {
      const me = user;
      const sharedAsMember =
        me !== null && me.role === 'member' && task.assigneeId === null;
      // raw snapshot for rollback (the incoming task is a view-task)
      const snapshot = tasks.find((t) => t.id === task.id);
      // optimistic
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== task.id) return t;
          if (sharedAsMember && me) {
            return {
              ...t,
              status: 'open',
              completedAt: null,
              myCompleted: false,
              completions: (t.completions ?? []).filter(
                (c) => c.userId !== me.id,
              ),
            };
          }
          return { ...t, status: 'open', completedAt: null };
        }),
      );
      try {
        const updated = await api.updateTask(task.id, { status: 'open' });
        setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      } catch {
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? (snapshot ?? task) : t)),
        );
      }
    },
    [tasks, user],
  );

  const handleSave = useCallback(
    async (id: number, input: UpdateTaskInput) => {
      const updated = await api.updateTask(id, input);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setExpandedId(null);
    },
    [],
  );

  const handleDelete = useCallback(async (id: number) => {
    const removed = tasks.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setExpandedId(null);
    try {
      await api.deleteTask(id);
    } catch {
      // re-insert only the deleted task; ordering self-corrects on next poll
      if (removed) {
        setTasks((prev) =>
          prev.some((t) => t.id === id) ? prev : [removed, ...prev],
        );
      }
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

  const collapseExpanded = useCallback(() => {
    setExpandedId(null);
  }, []);

  const handleCancelSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
  }, []);

  const handleRetryLoad = useCallback(() => {
    if (user) void loadInitial(user);
  }, [user, loadInitial]);

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

  // Map raw tasks to the current user's view-model (member sees a shared task
  // as done once HE marked it, with his own completion date).
  const viewTasks = toViewTasks(tasks, { isAdmin, userId: user.id });

  // Apply admin assignee filter (client-side).
  const visibleTasks =
    isAdmin && assigneeFilter !== 'all'
      ? viewTasks.filter((t) =>
          assigneeFilter === 'shared'
            ? t.assigneeId === null
            : t.assigneeId === assigneeFilter,
        )
      : viewTasks;

  // Quick Find searches globally (Things-style) — bypass the assignee
  // segmented filter while a query is active so admins don't get a subset
  // of results without realizing it. Counts/badges stay on the filtered set.
  const isSearching = showSearch && searchQuery.trim().length > 0;
  const searchableTasks = isSearching ? viewTasks : visibleTasks;

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
          <h1 className="header__title">
            {view === 'users' ? 'Сотрудники' : TAB_TITLES[tab]}
          </h1>
          <div className="header__user">
            {view === 'users' ? (
              <button
                type="button"
                className="header__done"
                onClick={() => setView('tasks')}
              >
                Готово
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="header__search-btn"
                  onClick={() => setShowSearch(true)}
                  aria-label="Поиск"
                >
                  <SearchIcon size={20} />
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    className="header__name header__name--btn"
                    onClick={() => setView('users')}
                    aria-label="Управление пользователями"
                  >
                    {user.displayName}
                  </button>
                ) : (
                  <span className="header__name">{user.displayName}</span>
                )}
                <button
                  type="button"
                  className="header__logout"
                  onClick={() => void handleLogout()}
                >
                  Выйти
                </button>
              </>
            )}
          </div>
        </div>

        {view === 'tasks' && showSearch && (
          <div className="search-bar">
            <input
              type="text"
              className="search-bar__input"
              placeholder="Поиск"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="search-bar__cancel"
              onClick={handleCancelSearch}
            >
              Отмена
            </button>
          </div>
        )}

        {view === 'tasks' && isAdmin && (
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

      {view === 'tasks' && showPushBanner && (
        <div className="push-banner" role="region" aria-label="Уведомления">
          <span className="push-banner__text">
            Включайте уведомления о новых задачах и сроках
          </span>
          <button
            type="button"
            className="btn btn--primary push-banner__enable"
            onClick={() => void handleEnablePush()}
          >
            Включить
          </button>
          <button
            type="button"
            className="push-banner__dismiss"
            onClick={dismissPushBanner}
            aria-label="Скрыть"
          >
            ×
          </button>
        </div>
      )}

      {view === 'tasks' && expandedId !== null && (
        <button
          type="button"
          className="backdrop-dim"
          onClick={collapseExpanded}
          aria-label="Свернуть задачу"
        />
      )}

      <main className="content">
        {view === 'users' ? (
          <UsersScreen
            currentUser={user}
            users={users}
            onUsersChanged={refetchUsers}
            onTasksChanged={refetch}
          />
        ) : loadError ? (
          <div className="load-error" role="alert">
            <p className="load-error__text">Не удалось загрузить задачи</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleRetryLoad}
            >
              Повторить
            </button>
          </div>
        ) : (
          <TaskList
            tab={tab}
            tasks={searchableTasks}
            currentUser={user}
            members={members}
            expandedId={expandedId}
            leavingIds={leavingIds}
            searchQuery={showSearch ? searchQuery : undefined}
            onToggleExpand={toggleExpand}
            onComplete={handleComplete}
            onReopen={handleReopen}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        )}
      </main>

      {view === 'tasks' && (
        <>
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
        </>
      )}
    </div>
  );
}
