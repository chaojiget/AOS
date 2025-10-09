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
  | 'mcp.logs.subscribe'
  | 'events.read'
  | 'events.write'
  | 'events.subscribe'
  | 'projects.read'
  | 'projects.write'
  | 'projects.execute';

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
    'events.read',
    'events.write',
    'events.subscribe',
    'projects.read',
    'projects.write',
    'projects.execute',
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
    'events.read',
    'events.write',
    'events.subscribe',
    'projects.read',
    'projects.write',
    'projects.execute',
  ],
  operator: [
    'mcp.registry.read',
    'mcp.registry.call',
    'mcp.sandbox.read',
    'mcp.sandbox.execute',
    'mcp.logs.read',
    'mcp.logs.subscribe',
    'events.read',
    'events.subscribe',
    'projects.read',
    'projects.execute',
  ],
  viewer: [
    'mcp.registry.read',
    'mcp.sandbox.read',
    'mcp.logs.read',
    'events.read',
    'projects.read',
  ],
};

const everyonePermissions: Permission[] = [];

export const hasPermission = (role: Role, permission: Permission): boolean => {
  return rolePermissions[role].includes(permission) || everyonePermissions.includes(permission);
};

export const listPermissionsByRole = (role: Role): Permission[] => rolePermissions[role];
