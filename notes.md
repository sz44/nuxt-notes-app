# goal
Build a small Google Keep-inspired notes app for authenticated users.

# MVP Scope
- Sign in with Google.
- Create, read, update, delete plain text notes.
- Show only the signed-in user's active notes.
- Sort notes by most recently created.
- Search active notes by note body.
- Vertical list view.

# Out of Scope for MVP
- Tags
- Images
- Checklists
- Reminders
- Archive
- Sharing
- Offline sync
- Password login

# Architecture
- Nuxt 4 app deployed to Vercel.
- Turso/libSQL database.
- Server API routes for auth and notes.
- Search uses libSQL/SQLite FTS5 on Turso Cloud.

# Auth
- Client obtains Google credential through Google Identity Services.
- Server verifies credential with Google.
- Server creates or finds user by Google subject ID.
- Server creates a session and stores hashed session secret.
- Session cookie is HttpOnly, Secure, SameSite=Lax.
- Logout deletes the current session.

# Notes Behavior
- Empty notes cannot be created.
- Editing a note updates `updated_at`.
- Deleted notes set `deleted_at`; they are hidden from normal list/search.
- Deleted notes are removed permanently from the user's perspective. The MVP does not include trash or recovery UI.
- Search returns only current user's non-deleted notes.

# Search
Use libSQL/SQLite FTS5 on Turso Cloud.

Earlier notes assumed Turso native FTS with `CREATE INDEX ... USING fts`, `fts_match`, `fts_score`, and `fts_highlight`. Testing against Turso Cloud rejected `USING fts`, and current research indicates Turso Cloud uses libSQL with SQLite-compatible FTS5 support rather than that native FTS API.

Create an external-content FTS5 table over note body:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
USING fts5(
  body,
  content='notes',
  content_rowid='rowid'
);
```

Keep the FTS table synchronized with triggers:

```sql
CREATE TRIGGER IF NOT EXISTS notes_ai
AFTER INSERT ON notes
BEGIN
  INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad
AFTER DELETE ON notes
BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body)
  VALUES('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_au
AFTER UPDATE OF body ON notes
BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body)
  VALUES('delete', old.rowid, old.body);
  INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
END;
```

Search should:
- query only the signed-in user's non-deleted notes
- join FTS results back to `notes` and enforce `user_id` and `deleted_at IS NULL` on `notes`
- filter token/prefix matches via `notes_fts MATCH ?`
- also include substring matches via `LIKE` so searches such as `ix` can find a note containing `six`
- support relevance ordering via `bm25(notes_fts)` or FTS5 `rank`
- fall back to `created_at DESC` when no search query is active
- use FTS5 `highlight(notes_fts, 0, '<mark>', '</mark>')` to return highlighted note body for search results
- limit search results to 50 notes

Search query shape:

```sql
SELECT
  notes.id,
  notes.body,
  notes.created_at,
  notes.updated_at,
  fts_matches.search_relevance,
  fts_matches.highlighted_body
FROM notes
LEFT JOIN (
  SELECT
    rowid,
    bm25(notes_fts) AS search_relevance,
    highlight(notes_fts, 0, '<mark>', '</mark>') AS highlighted_body
  FROM notes_fts
  WHERE notes_fts MATCH ?
) AS fts_matches ON fts_matches.rowid = notes.rowid
WHERE notes.user_id = ?
  AND notes.deleted_at IS NULL
  AND (
    fts_matches.rowid IS NOT NULL
    OR lower(notes.body) LIKE '%' || lower(?) || '%'
  )
ORDER BY notes.created_at DESC
LIMIT 50;
```

FTS5 notes:
- Lower `bm25(notes_fts)` values indicate higher relevance.
- FTS5 does not match arbitrary substrings inside a token with the default tokenizer. Use `LIKE` alongside FTS5 when substring search is part of the product behavior.
- The MVP intentionally keeps ordering stable with `created_at DESC`, even for search results, to avoid notes jumping while users edit.
- Soft deletes do not need to remove rows from `notes_fts` as long as every search joins to `notes` and filters `deleted_at IS NULL`.
- If a future hard-delete path is added, the delete trigger keeps `notes_fts` in sync.
- Existing notes need a one-time backfill after creating `notes_fts`: `INSERT INTO notes_fts(rowid, body) SELECT rowid, body FROM notes;`

# API
- POST /api/auth/google: verifies Google credential and creates a session.
- POST /api/auth/logout: deletes the current session.
- GET /api/me: returns current user or 401.
- GET /api/notes?q=: lists current user's non-deleted notes.
- POST /api/notes: creates a note.
- PATCH /api/notes/:id: updates note body.
- DELETE /api/notes/:id: soft-deletes note.

# Acceptance Criteria
- Unauthenticated users are redirected to sign-in.
- A user cannot read, edit, search, or delete another user's notes.
- Creating whitespace-only notes is rejected.
- Editing a note changes `updated_at`.
- Deleted notes do not appear in list or search.
- Empty search shows notes by `created_at DESC`.
- Non-empty search shows matching notes by `created_at DESC`.
- Non-empty search supports token, prefix, and substring matches.

# FTS5 Implementation Plan
1. Replace the native FTS migration in `server/utils/db.ts` with `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(...)`.
2. Add insert, delete, and `body` update triggers to keep `notes_fts` synchronized.
3. Add an idempotent backfill for existing notes. Prefer `INSERT INTO notes_fts(notes_fts) VALUES('rebuild')` for external-content FTS5 if supported; otherwise insert missing rows from `notes`.
4. Remove `TURSO_ENABLE_NATIVE_FTS` and the native FTS feature gate from runtime config.
5. Update `GET /api/notes?q=` to query `notes_fts MATCH ?`, join back to `notes`, and keep `ORDER BY notes.created_at DESC`.
6. Keep the existing `LIKE` fallback only if FTS5 table creation fails, and log a clear warning.
7. Sanitize highlighted HTML before returning it to the client, preserving only generated `<mark>` tags.

# database
```sql
users (
  id TEXT NOT NULL PRIMARY KEY, 
  google_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)

sessions (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
)

notes (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
)

CREATE INDEX idx_sessions_user_id
ON sessions(user_id);

CREATE INDEX idx_notes_user_updated
ON notes(user_id, deleted_at, updated_at DESC);

CREATE INDEX idx_notes_user_created
ON notes(user_id, deleted_at, created_at DESC);
```

# UI
Header:
- centered search bar 
- user account button dropdown with sign out

Main:
- centered rectangle that looks like text area with placeholder "Take a note..."
- list of notes
