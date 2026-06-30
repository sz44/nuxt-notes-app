import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  await ensureDb()

  const user = await requireUser(event)
  const body = await readBody<{ body?: string }>(event)
  const noteBody = String(body.body || '').trim()

  if (!noteBody) {
    throw createError({ statusCode: 400, statusMessage: 'Note body is required' })
  }

  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  await useDb().execute({
    sql: 'INSERT INTO notes (id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    args: [id, user.id, noteBody, now, now]
  })

  return {
    note: {
      id,
      body: noteBody,
      createdAt: now,
      updatedAt: now,
      highlightedBody: null,
      searchRelevance: null
    }
  }
})
