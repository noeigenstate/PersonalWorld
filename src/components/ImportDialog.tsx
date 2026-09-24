import { useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, Info, ShieldCheck, Upload, X } from 'lucide-react'

export function ImportDialog({ importing, onFiles, onClose }: { importing: boolean; onFiles: (files: File[]) => void; onClose: () => void }) {
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) onClose() }}>
      <section className="import-modal" role="dialog" aria-modal="true" aria-label="导入影像">
        <div className="modal-header">
          <div><span className="section-kicker">IMPORT</span><h2>导入你的影像</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭导入窗口" disabled={importing}><X size={20} /></button>
        </div>
        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); onFiles(Array.from(event.dataTransfer.files)) }}
        >
          <span className="drop-icon"><Upload size={27} strokeWidth={1.6} /></span>
          <h3>{importing ? '正在读取影像…' : '拖拽照片到这里'}</h3>
          <p>或从设备中选择照片、视频和截图</p>
          <button className="button button-primary" onClick={() => input.current?.click()} disabled={importing}>选择文件<ArrowRight size={17} /></button>
        </div>
        <div className="import-notes">
          <span><ShieldCheck size={16} />原始文件保存在本浏览器</span>
          <span><CheckCircle2 size={16} />自动跳过完全重复文件</span>
          <span><Info size={16} />微信发送的图片会丢失拍摄时间、定位和设备；请用"原图"或从相册导出</span>
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif,video/*" multiple hidden onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
      </section>
    </div>
  )
}
