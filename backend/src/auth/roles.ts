export type Role = 'owner' | 'admin' | 'operator' | 'viewer';

export const isRole = (value: unknown): value is Role => {
  return value === 'owner' || value === 'admin' || value === 'operator' || value === 'viewer';
};

export const rolePriority: Record<Role, number> = {
  owner: 4,
  admin: 3,
  operator: 2,
  viewer: 1,
};

export const normalizeRole = (value: string): Role => {
  const lowered = value.toLowerCase();
  if (isRole(lowered)) {
    return lowered;
  }
  throw new Error(`未知角色: ${value}`);
};
