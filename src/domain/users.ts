import { all, one } from '../db/index.js';
import type { Db } from '../db/index.js';
import type { Farm, Role, User } from './types.js';

export function getUser(db: Db, id: number): User | null {
  return one<User>(db, 'SELECT * FROM users WHERE id = ?', id);
}

export function listUsersByRole(db: Db, role: Role): User[] {
  return all<User>(db, 'SELECT * FROM users WHERE role = ? ORDER BY id', role);
}

export function listDemoAccounts(db: Db): User[] {
  return all<User>(db, 'SELECT * FROM users ORDER BY CASE role WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 ELSE 3 END, id', 'farmer', 'consumer', 'hub_operator');
}

export function farmOf(db: Db, userId: number): Farm | null {
  return one<Farm>(db, 'SELECT * FROM farms WHERE user_id = ? ORDER BY id LIMIT 1', userId);
}
