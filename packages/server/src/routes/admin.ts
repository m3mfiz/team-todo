import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import {
  createUser,
  setUserPassword,
  softDeleteUser,
} from '../services/user-admin.service.ts';

const passwordSchema = z
  .string()
  .min(6, 'password must be at least 6 characters')
  .max(72, 'password must be at most 72 characters');

const createUserSchema = z.object({
  username: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{2,29}$/,
      'username must be 3-30 chars: a lowercase letter followed by lowercase letters, digits or underscores',
    ),
  displayName: z.string().min(1).max(100),
  password: passwordSchema,
});

const setPasswordSchema = z.object({
  password: passwordSchema,
});

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'id must be a numeric string'),
});

export function registerAdminRoutes(app: FastifyInstance, db: DB): void {
  const adminOnly = { preHandler: [app.authenticate, app.requireAdmin] };

  app.post('/api/admin/users', adminOnly, async (request, reply) => {
    const body = createUserSchema.parse(request.body);
    const user = await createUser(db, body);
    reply.code(201);
    return user;
  });

  app.delete('/api/admin/users/:id', adminOnly, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    softDeleteUser(db, Number(id), request.user.id);
    return { ok: true };
  });

  app.post('/api/admin/users/:id/password', adminOnly, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { password } = setPasswordSchema.parse(request.body);
    await setUserPassword(db, Number(id), password);
    return { ok: true };
  });
}
