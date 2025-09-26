import { Role, normalizeRole } from './roles';

export interface TokenDescriptor {
  token: string;
  role: Role;
  label?: string;
}

let cachedTokens: TokenDescriptor[] | null = null;

const parseTokensConfig = (): TokenDescriptor[] => {
  const raw = process.env.AOS_API_TOKENS;
  if (!raw) {
    console.warn('[AUTH] 未配置 AOS_API_TOKENS，所有受保护接口将拒绝访问');
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((record) => {
          if (!record || typeof record !== 'object') return null;
          const token = typeof (record as any).token === 'string' ? (record as any).token : null;
          const roleValue = typeof (record as any).role === 'string' ? (record as any).role : null;
          if (!token || !roleValue) return null;
          const descriptor: TokenDescriptor = {
            token,
            role: normalizeRole(roleValue),
          };
          if (typeof (record as any).label === 'string') {
            descriptor.label = (record as any).label as string;
          }
          return descriptor;
        })
        .filter((entry): entry is TokenDescriptor => entry !== null);
    }

    if (typeof parsed === 'object' && parsed !== null) {
      return Object.entries(parsed)
        .map(([token, roleValue]) => {
          if (typeof roleValue !== 'string') return null;
          const descriptor: TokenDescriptor = { token, role: normalizeRole(roleValue) };
          return descriptor;
        })
        .filter((entry): entry is TokenDescriptor => entry !== null);
    }

    throw new Error('配置必须是对象或数组');
  } catch (error) {
    console.error('[AUTH] 解析 AOS_API_TOKENS 失败:', error);
    return [];
  }
};

const ensureTokens = (): TokenDescriptor[] => {
  if (!cachedTokens) {
    cachedTokens = parseTokensConfig();
  }
  return cachedTokens;
};

export const resolveToken = (token: string): TokenDescriptor | null => {
  const descriptor = ensureTokens().find((item) => item.token === token);
  return descriptor ?? null;
};

export const getAllTokenDescriptors = (): TokenDescriptor[] => ensureTokens();
