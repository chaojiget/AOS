import { Request, Response, NextFunction } from 'express';
import { hasPermission, Permission } from './permissions';
import { resolveToken } from './tokens';
import { Role } from './roles';

export interface AuthContext {
  token: string;
  role: Role;
  subject: string;
}

const devBypassEnabled =
  process.env.NODE_ENV !== 'production' && process.env.AOS_AUTH_DEV_BYPASS !== 'false';

let devBypassLogged = false;

const extractToken = (req: Request): string | null => {
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  const apiKey = req.get('x-api-key');
  if (apiKey) {
    return apiKey.trim();
  }

  const tokenQuery = req.query?.token;
  if (typeof tokenQuery === 'string' && tokenQuery.trim()) {
    return tokenQuery.trim();
  }

  if (Array.isArray(tokenQuery) && tokenQuery.length > 0) {
    const candidate = tokenQuery[0];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

export const requireAuth = (permission: Permission, options?: { resource?: string }) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (devBypassEnabled) {
      if (!devBypassLogged) {
        console.warn('[AUTH] 开发环境启用自动认证（AOS_AUTH_DEV_BYPASS）。');
        devBypassLogged = true;
      }

      const bypassRole: Role = 'owner';
      const context: AuthContext = {
        token: 'dev-bypass-token',
        role: bypassRole,
        subject: 'dev-bypass',
      };

      (req as any).auth = context;
      res.setHeader('x-auth-role', context.role);
      if (options?.resource) {
        res.setHeader('x-auth-resource', options.resource);
      }

      next();
      return;
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: '未提供认证信息' });
    }

    const descriptor = resolveToken(token);
    if (!descriptor) {
      return res.status(401).json({ error: '无效的 API Token' });
    }

    if (!hasPermission(descriptor.role, permission)) {
      return res.status(403).json({ error: '权限不足' });
    }

    const subject = descriptor.label ?? `${descriptor.role}:${token.slice(0, 6)}...`;
    (req as any).auth = {
      token,
      role: descriptor.role,
      subject,
    } satisfies AuthContext;

    res.setHeader('x-auth-role', descriptor.role);
    if (options?.resource) {
      res.setHeader('x-auth-resource', options.resource);
    }

    next();
  };
};

export const getAuthContext = (req: Request): AuthContext | undefined => {
  return (req as any).auth as AuthContext | undefined;
};
