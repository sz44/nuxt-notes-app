export default defineEventHandler(async (event) => {
  await deleteCurrentSession(event)
  return { ok: true }
})
