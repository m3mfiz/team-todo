export type Role = 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export type TaskStatus = 'open' | 'done';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  deadline: string | null; // 'YYYY-MM-DD' | null
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creatorId: string;
  creatorName: string;
  assigneeId: string | null; // null = «всем»
  assigneeName: string | null;
}

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  deadline?: string | null;
  assigneeId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  deadline?: string | null;
  assigneeId?: string | null;
  status?: TaskStatus;
}

export type TabKey = 'today' | 'upcoming' | 'all' | 'logbook';
