export default defineEventHandler(async (event) => {
  await ensureDb()

  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Note id is required' })
  }

  const result = await useDb().execute({
    sql: `UPDATE notes
      SET deleted_at = ?
      WHERE id = ?
        AND user_id = ?
        AND deleted_at IS NULL`,
    args: [Math.floor(Date.now() / 1000), id, user.id]
  })

  if (result.rowsAffected === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Note not found' })
  }

  return { ok: true }
})
