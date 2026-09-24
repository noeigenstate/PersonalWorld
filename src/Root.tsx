import { useEffect, useState } from 'react'
import App from './App'
import { AuthPage } from './components/AuthPage'
import { SIGNED_OUT_EVENT, fetchAccount, signOut, type Account } from './lib/api'
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
  return <App key={account.id} account={account} onSignOut={() => void leave()} />
}
