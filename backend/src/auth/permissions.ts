import { Role } from './roles';

export type Permission =
  | 'mcp.registry.read'
  | 'mcp.registry.write'
  | 'mcp.registry.call'
  | 'mcp.sandbox.read'
  | 'mcp.sandbox.write'
  | 'mcp.sandbox.execute'
  | 'mcp.logs.read'
  | 'mcp.logs.write'
  | 'mcp.logs.subscribe';

const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    'mcp.registry.read',
    'mcp.registry.write',
    'mcp.registry.call',
    'mcp.sandbox.read',
    'mcp.sandbox.write',
    'mcp.sandbox.execute',
    'mcp.logs.read',
    'mcp.logs.write',
    'mcp.logs.subscribe',
  ],
  admin: [
    'mcp.registry.read',
    'mcp.registry.write',
    'mcp.registry.call',
    'mcp.sandbox.read',
    'mcp.sandbox.write',
    'mcp.sandbox.execute',
    'mcp.logs.read',
    'mcp.logs.write',
    'mcp.logs.subscribe',
  ],
  operator: [
    'mcp.registry.read',
    'mcp.registry.call',
    'mcp.sandbox.read',
    'mcp.sandbox.execute',
    'mcp.logs.read',
    'mcp.logs.subscribe',
  ],
  viewer: [
    'mcp.registry.read',
    'mcp.sandbox.read',
    'mcp.logs.read',
  ],
};

const everyonePermissions: Permission[] = [];

export const hasPermission = (role: Role, permission: Permission): boolean => {
  return rolePermissions[role].includes(permission) || everyonePermissions.includes(permission);
};

export const listPermissionsByRole = (role: Role): Permission[] => rolePermissions[role];
