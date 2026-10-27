import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/sqlite';
import { Customer } from '../models/auth';
import { AuthRepository } from '../repositories/authRepo';
import { ForbiddenError, UnauthorizedError } from './errors';

export function sessionToken(req: Request): string | undefined {
  return req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('octocat_session='))?.slice('octocat_session='.length);
}

export async function currentUser(req: Request): Promise<Customer | null> {
  return new AuthRepository((await getDatabase()).db).current(sessionToken(req))?.user ?? null;
}

export async function requireUser(req: Request): Promise<Customer> {
  const user = await currentUser(req);
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireAdmin(req: Request): Promise<Customer> {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new ForbiddenError();
  return user;
}

export function protectOrigin(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.get('Origin');
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const configured = process.env.API_CORS_ORIGINS;
    const allowed = configured
      ? configured.split(',').map((value) => value.trim()).includes(origin)
      : ['http://localhost:5137', 'http://127.0.0.1:5137'].includes(origin) ||
        /^https:\/\/.*\.(app\.github\.dev|azurecontainerapps\.io)$/.test(origin);
    if (!allowed) { next(new ForbiddenError('Request origin is not allowed')); return; }
  }
  next();
}

export const sessionCookieOptions = () => ({
  httpOnly: true, sameSite: 'lax' as const, path: '/api',
  secure: process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production',
});
