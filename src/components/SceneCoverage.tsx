import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { useSceneCoverage } from '../lib/useSceneCoverage'

export function SceneCoverage({coverage,onFocus}:{coverage:ReturnType<typeof useSceneCoverage>;onFocus:(id:string)=>void}){
  const [open,setOpen]=useState(false)
  return <><button className="button button-subtle" onClick={()=>{setOpen(true);coverage.acknowledge()}}>{coverage.done<coverage.total?`检查街区 ${coverage.done}/${coverage.total}`:`${coverage.total} 处照片区域`}{coverage.newCount>0&&<span className="coverage-new">{coverage.newCount} 处新地点</span>}</button>
    {open&&createPortal(<div className="modal-backdrop" onClick={()=>setOpen(false)}><section className="memory-library" role="dialog" aria-modal="true" aria-labelledby="coverage-heading" onClick={e=>e.stopPropagation()}><header className="modal-header"><div><span className="section-kicker">照片去过的地方</span><h2 id="coverage-heading">街区场景清单</h2></div><button className="icon-button" aria-label="关闭场景清单" onClick={()=>setOpen(false)}><X/></button></header><p>新地点会自动载入地理资料并使用通用卡通场景。专属建筑需要参考资料与模型精修；清单不会把通用场景标为精修完成。</p><div className="coverage-rows">{coverage.rows.map(row=><article className="coverage-row" key={row.id}><div><strong>{row.name}</strong>{!row.seen&&<span className="coverage-new">新地点</span>}<p>{row.photoIds.length} 张照片 · {row.status==='loading'?'正在准备资料':row.status==='failed'?'资料读取失败':row.special.length?'附近含专属模型':'通用场景 · 待专属精修'}</p><p>{row.special.length?row.special.join('、')+'。':''}{row.note}</p></div><button className="button" onClick={()=>{onFocus(row.photoIds[0]);setOpen(false)}}>到这里看看</button></article>)}</div>{coverage.error&&<p role="alert">{coverage.error}</p>}</section></div>,document.body)}
  </>
}
