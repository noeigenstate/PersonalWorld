import { useState } from 'react'
import { Aperture, ArrowRight, ShieldCheck } from 'lucide-react'
import { signIn, signUp, type Account } from '../lib/api'

const HINT_KEY = 'pw:has-account'

function rememberedAccount() {
  try { return localStorage.getItem(HINT_KEY) === '1' } catch { return false }
}

export function AuthPage({ onSignedIn, notice }: { onSignedIn: (account: Account) => void; notice?: string }) {
  const [mode, setMode] = useState<'register' | 'login'>(rememberedAccount() ? 'login' : 'register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const registering = mode === 'register'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const account = registering ? await signUp(username.trim(), password) : await signIn(username.trim(), password)
      try { localStorage.setItem(HINT_KEY, '1') } catch { /* private mode */ }
      onSignedIn(account)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(registering ? 'login' : 'register')
    setError('')
  }

  return (
    <main className="auth">
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="auth-brand"><Aperture size={22} strokeWidth={2} />Personal World</span>
        <h1 id="auth-title">{registering ? '创建你的账户' : '欢迎回来'}</h1>
        <p className="auth-sub">{registering ? '用户名和密码就够了。' : '登录后继续整理你的人生地图。'}</p>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form onSubmit={submit}>
          <label htmlFor="auth-username">用户名</label>
          <input id="auth-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required minLength={2} maxLength={20} />
          <label htmlFor="auth-password">密码</label>
          <input id="auth-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 6 : 1} placeholder={registering ? '至少 6 位' : ''} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? '请稍候…' : registering ? '注册' : '登录'}<ArrowRight size={17} /></button>
        </form>
        <p className="auth-switch">{registering ? '已有账户？' : '还没有账户？'}<button type="button" onClick={switchMode}>{registering ? '登录' : '注册'}</button></p>
        <p className="auth-local"><ShieldCheck size={15} />照片和记忆只保存在这台设备的浏览器里，按账户分开存放，不会上传。</p>
      </section>
    </main>
  )
}
