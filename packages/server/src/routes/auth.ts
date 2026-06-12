import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { AppError } from '../utils/errors.ts';
import {
  getUserById,
  login,
  revokeToken,
  rotateRefreshToken,
  storeRefreshToken,
  type UserRow,
} from '../services/auth.service.ts';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

function publicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  };
}

export function registerAuthRoutes(app: FastifyInstance, db: DB): void {
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request) => {
      const { username, password } = loginSchema.parse(request.body);
      const user = await login(db, username, password);
      if (!user) {
        throw AppError.unauthorized('Invalid username or password');
      }
      const accessToken = app.signAccessToken({
        id: user.id,
        role: user.role,
      });
      const refreshToken = app.signRefreshToken({ id: user.id });
      storeRefreshToken(db, user.id, refreshToken);
      return { accessToken, refreshToken, user: publicUser(user) };
    },
  );

  app.post(
    '/api/auth/refresh',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request) => {
      const { refreshToken } = refreshSchema.parse(request.body);
      // Verify JWT signature/expiry first, then rotate in the DB.
      app.verifyRefreshToken(refreshToken);
      const userId = rotateRefreshToken(db, refreshToken);

      // Re-read the user so role changes take effect immediately.
      const user = getUserById(db, userId);
      if (!user) {
        throw AppError.unauthorized('User no longer exists');
      }

      const accessToken = app.signAccessToken({
        id: user.id,
        role: user.role,
      });
      const newRefreshToken = app.signRefreshToken({ id: user.id });
      storeRefreshToken(db, user.id, newRefreshToken);

      return {
        accessToken,
        refreshToken: newRefreshToken,
        user: publicUser(user),
      };
    },
  );

  app.post('/api/auth/logout', async (request) => {
    const { refreshToken } = logoutSchema.parse(request.body);
    revokeToken(db, refreshToken);
    return { ok: true };
  });

  app.get(
    '/api/auth/me',
    { preHandler: app.authenticate },
    async (request) => {
      const user = getUserById(db, request.user.id);
      if (!user) {
        throw AppError.unauthorized('User no longer exists');
      }
      return publicUser(user);
    },
  );
}
