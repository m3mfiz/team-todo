export type Role = 'admin' | 'member';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface AdminCreateUserInput {
  username: string;
  displayName: string;
  password: string;
}

export type TaskStatus = 'open' | 'done';

// Per-user completion mark on a shared («Всем») task.
export interface TaskCompletion {
  userId: number;
  displayName: string;
  completedAt: string;
}

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  deadline: string | null; // 'YYYY-MM-DD' | null
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creatorId: number;
  creatorName: string;
  assigneeId: number | null; // null = «всем»
  assigneeName: string | null;
  // Only present on shared tasks (assigneeId === null):
  // marks of living members, sorted by displayName.
  completions?: TaskCompletion[];
  // Only present on shared tasks: does the current user have a mark.
  myCompleted?: boolean;
}

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  deadline?: string | null;
  assigneeId?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  deadline?: string | null;
  assigneeId?: number | null;
  status?: TaskStatus;
}

export type TabKey = 'today' | 'upcoming' | 'all' | 'logbook';
