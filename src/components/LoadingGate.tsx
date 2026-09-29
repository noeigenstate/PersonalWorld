import { AlertCircle, CheckCircle2, Circle, LoaderCircle, PauseCircle } from 'lucide-react'

export type GateStepState = 'done' | 'active' | 'waiting' | 'paused' | 'error'

export interface GateStep {
  id: string
  label: string
  state: GateStepState
  detail: string
  // 0…1 when the amount of work is known
  progress?: number
  action?: { label: string; onClick: () => void }
}

const icons = {
  done: <CheckCircle2 size={18} />,
  // Static on purpose: icons never move in this app (CLAUDE.md); the bars show the activity
  active: <LoaderCircle size={18} />,
  waiting: <Circle size={18} />,
  paused: <PauseCircle size={18} />,
  error: <AlertCircle size={18} />,
}

function Steps({ steps }: { steps: GateStep[] }) {
  return (
    <ol className="load-gate-steps">
      {steps.map((step) => (
        <li key={step.id} className={`load-gate-step ${step.state}`} data-step={step.id}>
          <span className="load-gate-icon" aria-hidden="true">{icons[step.state]}</span>
          <div className="load-gate-body">
            <div className="load-gate-row">
              <b>{step.label}</b>
              {step.progress !== undefined && step.state !== 'done' && <small>{Math.round(step.progress * 100)}%</small>}
            </div>
            <small className="load-gate-detail">{step.detail}</small>
            {step.progress !== undefined && step.state !== 'done' && (
              <div className="load-gate-bar" role="progressbar" aria-label={step.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(step.progress * 100)}>
                <span style={{ width: `${Math.round(step.progress * 100)}%` }} />
              </div>
            )}
            {step.action && <button className="button button-subtle load-gate-action" onClick={step.action.onClick}>{step.action.label}</button>}
          </div>
        </li>
      ))}
    </ol>
  )
}

// Covers the map until its data, the map itself and the photo library are ready, so the map opens
// on a finished picture; the top bar stays usable (import, sign out) above it. The photo analysis
// is listed too but does not hold the map back: it carries on in the background (BackgroundProgress).
export function LoadingGate({ steps }: { steps: GateStep[] }) {
  const blocked = steps.find((step) => step.state === 'error' || step.state === 'paused')
  return (
    <div className="load-gate" role="dialog" aria-modal="true" aria-labelledby="load-gate-title">
      <section className="map-empty load-gate-card">
        <h2 id="load-gate-title">{blocked ? '准备工作需要处理' : '正在准备你的人生地图'}</h2>
        <p>{blocked ? '下面标出的步骤停下了，处理后会自动继续。' : '地图数据和地图准备好后就会打开地图，照片分析会在后台继续。'}</p>
        <Steps steps={steps} />
      </section>
    </div>
  )
}

// The photo analysis while the map is open: a small panel with the same steps, out of the way
export function BackgroundProgress({ steps }: { steps: GateStep[] }) {
  return (
    <aside className="load-gate-mini" role="status" aria-label="后台分析进度">
      <b className="load-gate-mini-title">正在后台分析照片</b>
      <Steps steps={steps} />
    </aside>
  )
}
