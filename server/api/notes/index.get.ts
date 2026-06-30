export default defineEventHandler(async (event) => {
  await ensureDb()

  const user = await requireUser(event)
  const query = getQuery(event)
  const search = String(query.q || '').trim()
  const db = useDb()

  if (search && canUseFts5()) {
    const ftsQuery = toFts5Query(search)

    const result = await db.execute({
      sql: `WITH fts_matches AS (
          SELECT
            rowid,
            bm25(notes_fts) AS search_relevance,
            highlight(notes_fts, 0, '<mark>', '</mark>') AS highlighted_body
          FROM notes_fts
          WHERE notes_fts MATCH ?
        )
        SELECT
          notes.id,
          notes.body,
          notes.created_at,
          notes.updated_at,
          fts_matches.search_relevance,
          fts_matches.highlighted_body
        FROM notes
        LEFT JOIN fts_matches ON fts_matches.rowid = notes.rowid
        WHERE notes.user_id = ?
          AND notes.deleted_at IS NULL
          AND (
            fts_matches.rowid IS NOT NULL
            OR lower(notes.body) LIKE '%' || lower(?) || '%'
          )
        ORDER BY notes.created_at DESC
        LIMIT 50`,
      args: [ftsQuery, user.id, search]
    })

    return {
      notes: result.rows.map((row) => {
        const note = mapNote(row)
        return {
          ...note,
          highlightedBody: note.highlightedBody || highlightFallback(note.body, search)
        }
      })
    }
  }

  if (search) {
    const result = await db.execute({
      sql: `SELECT id, body, created_at, updated_at
        FROM notes
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND lower(body) LIKE '%' || lower(?) || '%'
        ORDER BY created_at DESC
        LIMIT 50`,
      args: [user.id, search]
    })

    return { notes: result.rows.map((row) => ({ ...mapNote(row), highlightedBody: highlightFallback(String(row.body), search) })) }
  }

  const result = await db.execute({
    sql: `SELECT id, body, created_at, updated_at
      FROM notes
      WHERE user_id = ?
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50`,
    args: [user.id]
  })

  return { notes: result.rows.map(mapNote) }
})

function mapNote(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    body: String(row.body),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    highlightedBody: row.highlighted_body ? sanitizeHighlightedBody(String(row.highlighted_body)) : null,
    searchRelevance: row.search_relevance === undefined ? null : Number(row.search_relevance)
  }
}

function sanitizeHighlightedBody(value: string) {
  return escapeHtml(value)
    .replaceAll('&lt;mark&gt;', '<mark>')
    .replaceAll('&lt;/mark&gt;', '</mark>')
}

function toFts5Query(search: string) {
  const terms = search.match(/[\p{L}\p{N}_]+/gu) || []
  if (terms.length === 0) {
    return `"${search.replaceAll('"', '""')}"`
  }

  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ')
}

function highlightFallback(body: string, search: string) {
  const index = body.toLowerCase().indexOf(search.toLowerCase())
  if (index === -1) {
    return body
  }

  const match = body.slice(index, index + search.length)
  return `${escapeHtml(body.slice(0, index))}<mark>${escapeHtml(match)}</mark>${escapeHtml(body.slice(index + search.length))}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
