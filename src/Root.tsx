import { useEffect, useState } from 'react'
import App from './App'
import { AuthPage } from './components/AuthPage'
import { SIGNED_OUT_EVENT, acceptPrivacy, fetchAccount, signOut, type Account } from './lib/api'
import { PrivacyStatement } from './components/PrivacyStatement'
import { closeAccountStorage, openAccountStorage } from './lib/storage'

// undefined while checking the session, null when signed out
export default function Root() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [notice, setNotice] = useState('')

  async function enter(next: Account) {
    await openAccountStorage(next.id)
    setNotice('')
    setAccount(next)
  }

  useEffect(() => {
    fetchAccount()
      .then((found) => (found ? enter(found) : setAccount(null)))
      .catch(() => { setNotice('无法连接服务，请确认已运行 npm run dev'); setAccount(null) })
    const expired = () => {
      closeAccountStorage()
      setNotice('登录已过期，请重新登录')
      setAccount(null)
    }
    window.addEventListener(SIGNED_OUT_EVENT, expired)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, expired)
  }, [])

  async function leave() {
    await signOut().catch(() => undefined)
    closeAccountStorage()
    setAccount(null)
  }

  if (account === undefined) return <div className="auth" aria-busy="true" />
  if (!account) return <AuthPage notice={notice} onSignedIn={(next) => void enter(next)} />
  // Accounts created before the statement existed (or before it changed) accept it once
  if (!account.privacyAccepted) {
    return (
      <main className="auth">
        <section className="auth-card privacy-card" aria-labelledby="consent-title">
          <h1 id="consent-title">请阅读隐私声明</h1>
          <p className="auth-sub">继续使用前需要你同意。</p>
          <PrivacyStatement />
          <div className="privacy-actions">
            <button className="button button-subtle" onClick={() => void leave()}>退出登录</button>
            <button className="button button-primary" onClick={() => void acceptPrivacy().then(setAccount).catch(() => setNotice('没能保存，请重试'))}>同意并继续</button>
          </div>
        </section>
      </main>
    )
  }
  return <App key={account.id} account={account} onSignOut={() => void leave()} />
}
