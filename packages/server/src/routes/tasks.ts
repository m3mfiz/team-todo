import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from '../services/task.service.ts';

const deadlineSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'deadline must be YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && value === date.toISOString().slice(0, 10);
  }, 'deadline must be a valid date');

const createSchema = z.object({
  title: z.string().min(1).max(300),
  notes: z.string().max(5000).optional(),
  deadline: deadlineSchema.nullish(),
  assigneeId: z.number().int().nullish(),
});

const updateSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    notes: z.string().max(5000).optional(),
    deadline: deadlineSchema.nullable().optional(),
    assigneeId: z.number().int().nullable().optional(),
    status: z.enum(['open', 'done']).optional(),
  })
  .strict();

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'id must be a numeric string'),
});

export function registerTaskRoutes(app: FastifyInstance, db: DB): void {
  app.get(
    '/api/tasks',
    { preHandler: app.authenticate },
    async (request) => {
      return listTasks(db, request.user);
    },
  );

  app.post(
    '/api/tasks',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const task = createTask(db, request.user, {
        title: body.title,
        notes: body.notes,
        deadline: body.deadline ?? null,
        assigneeId: body.assigneeId,
      });
      reply.code(201);
      return task;
    },
  );

  app.patch(
    '/api/tasks/:id',
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const body = updateSchema.parse(request.body);
      return updateTask(db, request.user, Number(id), body);
    },
  );

  app.delete(
    '/api/tasks/:id',
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      deleteTask(db, request.user, Number(id));
      return { ok: true };
    },
  );
}
