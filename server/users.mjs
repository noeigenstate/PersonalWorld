// Accounts live on the server; each user's photos and memories stay in their own browser.
// Passwords are scrypt-hashed, session tokens are stored only as SHA-256 hashes.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const SESSION_DAYS = 30
const MAX_FAILURES = 5
const LOCK_MS = 60_000
export const SESSION_COOKIE = 'pw_session'
// Bump when the privacy statement changes; users then accept it again
export const PRIVACY_VERSION = '2026-09-28.4'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export async function hashPassword(password, salt = randomBytes(16)) {
  const key = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

async function verifyPassword(password, stored) {
  const [, saltHex, keyHex] = stored.split('$')
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  return expected.length === key.length && timingSafeEqual(expected, key)
}

export function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt, privacyAccepted: user.privacyVersion === PRIVACY_VERSION }
}

export function validateRegistration({ username, password }) {
  const name = String(username || '').trim()
  if (name.length < 2 || name.length > 20 || /\s/.test(name)) return '用户名需为 2–20 个字符，不能有空格'
  if (String(password || '').length < 6) return '密码至少 6 位'
  if (String(password).length > 128) return '密码不能超过 128 位'
  return null
}

export function createUserStore(file) {
  let data = { users: [], sessions: {} }
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // First run: the file is created on the first write
  }
  const failures = new Map()

  function save() {
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(data, null, 2))
    renameSync(temp, file)
  }

  function pruneSessions() {
    const now = Date.now()
    for (const [hash, session] of Object.entries(data.sessions)) if (session.expiresAt < now) delete data.sessions[hash]
  }

  function openSession(userId) {
    pruneSessions()
    const token = randomBytes(32).toString('base64url')
    data.sessions[sha256(token)] = { userId, expiresAt: Date.now() + SESSION_DAYS * 86400000 }
    save()
    return token
  }

  const findByName = (username) => data.users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase())

  return {
    sessionMaxAge: SESSION_DAYS * 86400,

    async register({ username, password, acceptPrivacy }) {
      const problem = validateRegistration({ username, password })
      if (problem) return { status: 400, error: problem }
      if (acceptPrivacy !== true) return { status: 400, error: '请先阅读并同意隐私声明' }
      if (findByName(username)) return { status: 409, error: '这个用户名已被注册' }
      const user = {
        id: randomUUID(),
        username: String(username).trim(),
        passwordHash: await hashPassword(String(password)),
        createdAt: new Date().toISOString(),
        privacyVersion: PRIVACY_VERSION,
        privacyAcceptedAt: new Date().toISOString(),
      }
      data.users.push(user)
      save()
      return { status: 201, user: publicUser(user), token: openSession(user.id) }
    },

    async login({ username, password }, ip) {
      const key = `${ip}|${String(username || '').trim().toLowerCase()}`
      const record = failures.get(key)
      if (record && record.count >= MAX_FAILURES && Date.now() - record.at < LOCK_MS) {
        return { status: 429, error: '尝试次数过多，请 1 分钟后再试' }
      }
      const user = findByName(username || '')
      const ok = user ? await verifyPassword(String(password || ''), user.passwordHash) : false
      if (!ok) {
        const count = record && Date.now() - record.at < LOCK_MS ? record.count + 1 : 1
        failures.set(key, { count, at: Date.now() })
        return { status: 401, error: '用户名或密码不正确' }
      }
      failures.delete(key)
      return { status: 200, user: publicUser(user), token: openSession(user.id) }
    },

    userForToken(token) {
      if (!token) return null
      const session = data.sessions[sha256(token)]
      if (!session || session.expiresAt < Date.now()) return null
      return data.users.find((u) => u.id === session.userId) || null
    },

    acceptPrivacy(userId) {
      const user = data.users.find((u) => u.id === userId)
      if (!user) return null
      user.privacyVersion = PRIVACY_VERSION
      user.privacyAcceptedAt = new Date().toISOString()
      save()
      return publicUser(user)
    },

    logout(token) {
      if (!token) return
      delete data.sessions[sha256(token)]
      save()
    },
  }
}

export function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

export function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}
