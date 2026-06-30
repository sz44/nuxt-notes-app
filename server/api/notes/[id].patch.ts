export default defineEventHandler(async (event) => {
  await ensureDb()

  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ body?: string }>(event)
  const noteBody = String(body.body || '').trim()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Note id is required' })
  }

  if (!noteBody) {
    throw createError({ statusCode: 400, statusMessage: 'Note body is required' })
  }

  const now = Math.floor(Date.now() / 1000)
  const result = await useDb().execute({
    sql: `UPDATE notes
      SET body = ?, updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND deleted_at IS NULL`,
    args: [noteBody, now, id, user.id]
  })

  if (result.rowsAffected === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Note not found' })
  }

  return {
    note: {
      id,
      body: noteBody,
      updatedAt: now
    }
  }
})
