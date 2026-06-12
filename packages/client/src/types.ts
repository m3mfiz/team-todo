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
