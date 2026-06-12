import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.ts';
import { createDb, migrate } from './index.ts';

export function runMigrate(dbPath: string = config.dbPath): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = createDb(dbPath);
  migrate(db);
  db.close();
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runMigrate();
  console.log(`Migration complete: ${config.dbPath}`);
}
