import { one } from '../db/index.js';
import type { Db } from '../db/index.js';
import { openDb } from '../db/index.js';
import { seed } from '../db/seed.js';
import type { Farm, User } from '../domain/types.js';

/** 파일에 손대지 않는 인메모리 DB + 시드. 테스트 간 완전히 독립적이다. */
export function freshDb(withListings = true): Db {
  const db = openDb(':memory:');
  seed(db, { withListings });
  return db;
}

export function farmerNamed(db: Db, name = '김복순'): { user: User; farm: Farm } {
  const user = one<User>(db, 'SELECT * FROM users WHERE name = ? AND role = ?', name, 'farmer');
  if (!user) throw new Error(`시드에 없는 농민: ${name}`);
  const farm = one<Farm>(db, 'SELECT * FROM farms WHERE user_id = ?', user.id);
  if (!farm) throw new Error('농가 정보 없음');
  return { user, farm };
}

export function consumerNamed(db: Db, name = '장바구니'): User {
  const user = one<User>(db, 'SELECT * FROM users WHERE name = ? AND role = ?', name, 'consumer');
  if (!user) throw new Error(`시드에 없는 소비자: ${name}`);
  return user;
}
