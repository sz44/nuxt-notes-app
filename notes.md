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
- Search uses TursoDB native FTS, instead of SQLite FTS5, if supported in the deployed Turso runtime.

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
Use TursoDB native FTS, backed internally by Tantivy, instead of SQLite FTS5.

Implementation gate: confirm the target Turso Cloud/runtime supports `USING fts`, `fts_match`, `fts_score`, and `fts_highlight` before relying on native FTS. If unavailable in the deployed environment, defer search or use a temporary fallback.

Create an FTS index over note content:

```sql
CREATE INDEX idx_notes_fts
ON notes USING fts (body);
```

Search should:
- query only the signed-in user's non-deleted notes
- filter via `fts_match`
- support relevance ordering via `fts_score`
- fall back to `created_at DESC` when no search query is active
- use `fts_highlight` to return highlighted note body for search results
- limit search results to 50 notes

Search query shape:

```sql
SELECT
  id,
  body,
  created_at,
  updated_at,
  fts_score(body, ?) AS search_relevance,
  fts_highlight(body, '<mark>', '</mark>', ?) AS highlighted_body
FROM notes
WHERE user_id = ?
  AND deleted_at IS NULL
  AND fts_match(body, ?) = 1
ORDER BY created_at DESC
LIMIT 50;
```

Turso FTS notes:
- Lower `fts_score` values indicate higher relevance.
- Turso FTS does not support the SQLite `MATCH` operator syntax; use `fts_match()`.
- FTS changes inside a transaction are visible to FTS queries after commit.
- Use `OPTIMIZE INDEX idx_notes_fts` after bulk imports or if search performance degrades.

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
