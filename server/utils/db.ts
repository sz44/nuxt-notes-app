import { createClient, type Client } from '@libsql/client'

let client: Client | undefined
let ready: Promise<void> | undefined
let nativeFtsAvailable = false

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

export function canUseNativeFts() {
  return nativeFtsAvailable
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

  const config = useRuntimeConfig()
  if (config.enableNativeFts) {
    try {
      await db.execute('CREATE INDEX IF NOT EXISTS idx_notes_fts ON notes USING fts (body)')
      nativeFtsAvailable = true
    } catch (error) {
      nativeFtsAvailable = false
      console.warn('Turso native FTS is unavailable; falling back to LIKE search.', error)
    }
  }
}
