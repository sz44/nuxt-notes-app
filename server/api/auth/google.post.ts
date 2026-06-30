import { randomUUID } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'

export default defineEventHandler(async (event) => {
  await ensureDb()

  const config = useRuntimeConfig()
  if (!config.googleClientId) {
    throw createError({ statusCode: 500, statusMessage: 'GOOGLE_CLIENT_ID is not configured' })
  }

  const body = await readBody<{ credential?: string }>(event)
  if (!body.credential) {
    throw createError({ statusCode: 400, statusMessage: 'Google credential is required' })
  }

  const client = new OAuth2Client(config.googleClientId)
  const ticket = await client.verifyIdToken({
    idToken: body.credential,
    audience: config.googleClientId
  })
  const payload = ticket.getPayload()

  if (!payload?.sub || !payload.email) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid Google credential' })
  }

  const db = useDb()
  const existing = await db.execute({
    sql: 'SELECT id, email FROM users WHERE google_id = ?',
    args: [payload.sub]
  })

  let userId = existing.rows[0]?.id ? String(existing.rows[0].id) : ''
  if (!userId) {
    userId = randomUUID()
    await db.execute({
      sql: 'INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)',
      args: [userId, payload.sub, payload.email]
    })
  } else if (existing.rows[0]?.email !== payload.email) {
    await db.execute({
      sql: 'UPDATE users SET email = ? WHERE id = ?',
      args: [payload.email, userId]
    })
  }

  await createSession(event, userId)

  return {
    user: {
      id: userId,
      email: payload.email
    }
  }
})
