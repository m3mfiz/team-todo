import { randomBytes } from 'node:crypto';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import type { DB } from '../db/index.ts';
import { AppError } from '../utils/errors.ts';

export interface AccessTokenPayload {
  id: number;
  role: 'admin' | 'member';
  aud?: 'access';
}

export interface RefreshTokenPayload {
  id: number;
  aud?: 'refresh';
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireAdmin: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    signAccessToken: (payload: { id: number; role: 'admin' | 'member' }) => string;
    signRefreshToken: (payload: { id: number }) => string;
    verifyRefreshToken: (token: string) => RefreshTokenPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: { id: number; role: 'admin' | 'member' };
  }
}

// Minimal shape of a namespaced @fastify/jwt decorator object.
interface NamespacedJwt {
  sign: (payload: object) => string;
  verify: <T>(token: string) => T;
}

export function registerAuth(app: FastifyInstance, _db: DB): void {
  // Access-token namespace (default decorators: app.jwt / request.jwtVerify).
  app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: {
      algorithm: 'HS256',
      aud: 'access',
      expiresIn: '15m',
    },
    verify: {
      allowedAud: 'access',
    },
  });

  // Refresh-token namespace (decorates app.jwt.refresh).
  app.register(fastifyJwt, {
    secret: config.jwtRefreshSecret,
    namespace: 'refresh',
    jwtSign: 'refreshJwtSign',
    jwtVerify: 'refreshJwtVerify',
    sign: {
      algorithm: 'HS256',
      aud: 'refresh',
      expiresIn: '7d',
    },
    verify: {
      allowedAud: 'refresh',
    },
  });

  app.decorate('signAccessToken', function (
    this: FastifyInstance,
    payload: { id: number; role: 'admin' | 'member' },
  ): string {
    return this.jwt.sign({ id: payload.id, role: payload.role });
  });

  app.decorate('signRefreshToken', function (
    this: FastifyInstance,
    payload: { id: number },
  ): string {
    const refreshJwt = (this.jwt as unknown as { refresh: NamespacedJwt })
      .refresh;
    // Include a random jti so two tokens minted in the same second (same iat)
    // never collide, keeping each refresh-token hash unique in the DB.
    return refreshJwt.sign({
      id: payload.id,
      jti: randomBytes(16).toString('hex'),
    });
  });

  app.decorate('verifyRefreshToken', function (
    this: FastifyInstance,
    token: string,
  ): RefreshTokenPayload {
    const refreshJwt = (this.jwt as unknown as { refresh: NamespacedJwt })
      .refresh;
    try {
      return refreshJwt.verify<RefreshTokenPayload>(token);
    } catch {
      throw AppError.unauthorized('Invalid refresh token');
    }
  });

  app.decorate('authenticate', async function (
    request: FastifyRequest,
  ): Promise<void> {
    try {
      const decoded = await request.jwtVerify<AccessTokenPayload>();
      request.user = { id: decoded.id, role: decoded.role };
    } catch {
      throw AppError.unauthorized('Invalid or missing access token');
    }
  });

  app.decorate('requireAdmin', async function (
    this: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await this.authenticate(request, reply);
    if (request.user.role !== 'admin') {
      throw AppError.forbidden('Admin privileges required');
    }
  });
}
