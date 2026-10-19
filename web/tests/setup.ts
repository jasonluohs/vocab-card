import 'fake-indexeddb/auto';
import { db } from '../src/db/db';

/** Give every test a fresh database. */
export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}
