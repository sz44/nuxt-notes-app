import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'

const sessionCookieName = 'notes_session'
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30

export type AuthUser = {
  id: string
  email: string
}

export async function createSession(event: H3Event, userId: string) {
  await ensureDb()

  const db = useDb()
  const id = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  const secretHash = hashSecret(secret)
  const expiresAt = Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds

  await db.execute({
    sql: 'INSERT INTO sessions (id, user_id, secret_hash, expires_at) VALUES (?, ?, ?, ?)',
    args: [id, userId, secretHash, expiresAt]
  })

  setCookie(event, sessionCookieName, `${id}.${secret}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeSeconds
  })
}

export async function deleteCurrentSession(event: H3Event) {
  await ensureDb()

  const parsed = parseSessionCookie(event)
  if (parsed) {
    await useDb().execute({
      sql: 'DELETE FROM sessions WHERE id = ?',
      args: [parsed.id]
    })
  }

  deleteCookie(event, sessionCookieName, { path: '/' })
}

export async function requireUser(event: H3Event): Promise<AuthUser> {
  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  return user
}

export async function getCurrentUser(event: H3Event): Promise<AuthUser | null> {
  await ensureDb()

  const parsed = parseSessionCookie(event)
  if (!parsed) {
    return null
  }

  const result = await useDb().execute({
    sql: `SELECT users.id, users.email, sessions.secret_hash, sessions.expires_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = ?`,
    args: [parsed.id]
  })

  const row = result.rows[0]
  if (!row || row.secret_hash !== hashSecret(parsed.secret)) {
    return null
  }

  if (Number(row.expires_at) <= Math.floor(Date.now() / 1000)) {
    await useDb().execute({ sql: 'DELETE FROM sessions WHERE id = ?', args: [parsed.id] })
    return null
  }

  return {
    id: String(row.id),
    email: String(row.email)
  }
}

function parseSessionCookie(event: H3Event) {
  const value = getCookie(event, sessionCookieName)
  if (!value) {
    return null
  }

  const [id, secret] = value.split('.')
  if (!id || !secret) {
    return null
  }

  return { id, secret }
}

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('base64url')
}
