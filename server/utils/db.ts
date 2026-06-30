import { createClient, type Client } from '@libsql/client'

let client: Client | undefined
let ready: Promise<void> | undefined
let fts5Available = false

export function useDb() {
  if (!client) {
    const config = useRuntimeConfig()
    client = createClient({
      url: config.tursoDatabaseUrl,
      authToken: config.tursoAuthToken || undefined
    })
  }

  return client
}

export async function ensureDb() {
  if (!ready) {
    ready = migrate()
  }

  await ready
}

export function canUseFts5() {
  return fts5Available
}

async function migrate() {
  const db = useDb()

  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT NOT NULL PRIMARY KEY,
      google_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      secret_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notes (
      id TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, deleted_at, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_notes_user_created ON notes(user_id, deleted_at, created_at DESC)'
  ], 'write')

  try {
    await db.batch([
      `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
        USING fts5(
          body,
          content='notes',
          content_rowid='rowid'
        )`,
      `CREATE TRIGGER IF NOT EXISTS notes_ai
        AFTER INSERT ON notes
        BEGIN
          INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
        END`,
      `CREATE TRIGGER IF NOT EXISTS notes_ad
        AFTER DELETE ON notes
        BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, body)
          VALUES('delete', old.rowid, old.body);
        END`,
      `CREATE TRIGGER IF NOT EXISTS notes_au
        AFTER UPDATE OF body ON notes
        BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, body)
          VALUES('delete', old.rowid, old.body);
          INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
        END`
    ], 'write')

    await db.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')")
    fts5Available = true
  } catch (error) {
    fts5Available = false
    console.warn('FTS5 is unavailable; falling back to LIKE search.', error)
  }
}
