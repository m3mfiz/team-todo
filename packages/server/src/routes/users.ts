import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.ts';

interface UserListRow {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
}

export function registerUserRoutes(app: FastifyInstance, db: DB): void {
  app.get(
    '/api/users',
    { preHandler: app.authenticate },
    async () => {
      const rows = db
        .prepare(
          'SELECT id, username, display_name, role FROM users ORDER BY role DESC, display_name ASC',
        )
        .all() as UserListRow[];
      return rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        role: u.role,
      }));
    },
  );
}
