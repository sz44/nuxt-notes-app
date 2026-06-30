export default defineEventHandler(async (event) => {
  return {
    user: await requireUser(event)
  }
})
