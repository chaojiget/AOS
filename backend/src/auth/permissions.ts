import { Role } from './roles';

export type Permission =
  | 'mcp.registry.read'
  | 'mcp.registry.write'
  | 'mcp.registry.call'
  | 'mcp.sandbox.read'
  | 'mcp.sandbox.write'
  | 'mcp.sandbox.execute';

const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    'mcp.registry.read',
    'mcp.registry.write',
    'mcp.registry.call',
    'mcp.sandbox.read',
    'mcp.sandbox.write',
    'mcp.sandbox.execute',
  ],
  admin: [
    'mcp.registry.read',
    'mcp.registry.write',
    'mcp.registry.call',
    'mcp.sandbox.read',
    'mcp.sandbox.write',
    'mcp.sandbox.execute',
  ],
  operator: [
    'mcp.registry.read',
    'mcp.registry.call',
    'mcp.sandbox.read',
    'mcp.sandbox.execute',
  ],
  viewer: [
    'mcp.registry.read',
    'mcp.sandbox.read',
  ],
};

const everyonePermissions: Permission[] = [];

export const hasPermission = (role: Role, permission: Permission): boolean => {
  return rolePermissions[role].includes(permission) || everyonePermissions.includes(permission);
};

export const listPermissionsByRole = (role: Role): Permission[] => rolePermissions[role];
