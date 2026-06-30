export default defineEventHandler(async (event) => {
  await ensureDb()

  const user = await requireUser(event)
  const query = getQuery(event)
  const search = String(query.q || '').trim()
  const db = useDb()

  if (search && canUseNativeFts()) {
    const result = await db.execute({
      sql: `SELECT
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
        LIMIT 50`,
      args: [search, search, user.id, search]
    })

    return { notes: result.rows.map(mapNote) }
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
