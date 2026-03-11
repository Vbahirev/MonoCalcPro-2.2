import type { Role } from './roles';

/**
 * Canonical permissions registry.
 *
 * IMPORTANT:
 * - UI uses these strings to hide/show actions.
 * - Firestore Rules remain the real security boundary.
 * - ROLE_CAPS define what *can ever* be granted for a role (superadmin ignores caps).
 */
export type Permission =
  // calculators
  | 'calc.use'
  // settings
  | 'settings.global.view'
  | 'settings.global.write'
  | 'settings.laser.view'
  | 'settings.laser.write'
  | 'settings.materials.read'
  | 'settings.materials.write'
  | 'settings.prices.read'
  | 'settings.prices.write'
  // users / admin
  | 'users.list.view'
  | 'users.permissions.edit'
  // invoice
  | 'invoice.stamp.edit'
  // trash
  | 'trash.view'
  | 'trash.restore'
  | 'trash.delete'
  | 'trash.purge'
  // history
  | 'history.view'
  | 'history.write'
  | 'history.bulkDelete'
  // kanban
  | 'kanban.view'
  | 'kanban.task.read'
  | 'kanban.task.create'
  | 'kanban.task.edit'
  | 'kanban.task.delete';

export const ROLE_CAPS: Record<Role, Permission[]> = {
  guest: ['calc.use', 'invoice.stamp.edit'],
  client: ['calc.use', 'invoice.stamp.edit'],
  // team/admin permissions are granted via "checkboxes" (users/{uid}.permissions)
  team: [
    'calc.use',
    'invoice.stamp.edit',
    'settings.global.view',
    'settings.materials.read',
    'settings.prices.read',
    'history.view',
    'history.write', 'history.bulkDelete',
    'trash.view',
    'trash.restore',
    'trash.delete',
    'trash.purge',
    'kanban.view',
    'kanban.task.read',
    'kanban.task.create',
    'kanban.task.edit',
    'kanban.task.delete',
  ],
  admin: [
    'settings.laser.view',
    'settings.laser.write',
    'calc.use',
    'settings.global.view',
    'settings.global.write',
    'settings.materials.read',
    'settings.materials.write',
    'settings.prices.read',
    'settings.prices.write',
    'users.list.view',
    'invoice.stamp.edit',
    'history.view',
    'history.write', 'history.bulkDelete',
    'trash.view',
    'trash.restore',
    'trash.delete',
    'trash.purge',
    'kanban.view',
    'kanban.task.read',
    'kanban.task.create',
    'kanban.task.edit',
    'kanban.task.delete',
  ],
  // superadmin ignores caps at runtime, but we keep full list for UI completeness
  superadmin: [
    'settings.laser.view',
    'settings.laser.write',
    'settings.laser.view',
    'settings.laser.write',
    'calc.use',
    'settings.global.view',
    'settings.global.write',
    'settings.materials.read',
    'settings.materials.write',
    'settings.prices.read',
    'settings.prices.write',
    'users.list.view',
    'users.permissions.edit',
    'invoice.stamp.edit',
    'trash.view',
    'trash.restore',
    'trash.delete',
    'trash.purge',
    'history.view',
    'history.write', 'history.bulkDelete',
    'kanban.view',
    'kanban.task.read',
    'kanban.task.create',
    'kanban.task.edit',
    'kanban.task.delete',
  ],
};

export function isPermAllowedForRole(role: Role, perm: Permission): boolean {
  return ROLE_CAPS[role]?.includes(perm) ?? false;
}
