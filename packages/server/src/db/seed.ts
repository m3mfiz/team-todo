import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.ts';
import { createDb, migrate, type DB } from './index.ts';
import { hashPassword } from '../utils/password.ts';

interface SeedUser {
  username: string;
  displayName: string;
  password: string;
  role: 'admin' | 'member';
}

const MEMBERS: ReadonlyArray<Omit<SeedUser, 'password' | 'role'>> = [
  { username: 'ivan', displayName: 'Иван' },
  { username: 'maria', displayName: 'Мария' },
  { username: 'sergey', displayName: 'Сергей' },
  { username: 'olga', displayName: 'Ольга' },
];

function userExists(db: DB, username: string): boolean {
  return (
    db.prepare('SELECT 1 FROM users WHERE username = ?').get(username) !==
    undefined
  );
}

async function insertUser(db: DB, user: SeedUser): Promise<boolean> {
  if (userExists(db, user.username)) {
    return false;
  }
  const passwordHash = await hashPassword(user.password);
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role)
     VALUES (?, ?, ?, ?)`,
  ).run(user.username, passwordHash, user.displayName, user.role);
  return true;
}

// Members are bootstrap-only: once ANY member row exists (live or
// soft-deleted), the roster is admin-managed and the seed must not touch it —
// otherwise a deploy would resurrect deliberately deleted employees with
// default passwords.
function hasAnyMember(db: DB): boolean {
  return (
    db.prepare(`SELECT 1 FROM users WHERE role = 'member' LIMIT 1`).get() !==
    undefined
  );
}

export async function seed(db: DB): Promise<string[]> {
  const created: string[] = [];

  const admin: SeedUser = {
    username: config.adminUsername,
    displayName: 'Администратор',
    password: config.adminPassword,
    role: 'admin',
  };
  if (await insertUser(db, admin)) {
    created.push(admin.username);
  }

  if (!hasAnyMember(db)) {
    for (const member of MEMBERS) {
      const inserted = await insertUser(db, {
        username: member.username,
        displayName: member.displayName,
        password: `${member.username}123`,
        role: 'member',
      });
      if (inserted) {
        created.push(member.username);
      }
    }
  }

  return created;
}

async function main(): Promise<void> {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = createDb(config.dbPath);
  migrate(db);
  const created = await seed(db);
  db.close();
  if (created.length > 0) {
    console.log(`Seeded users: ${created.join(', ')}`);
  } else {
    console.log('Seed: all users already exist, nothing to do.');
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
