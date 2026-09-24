// Keep in sync with PRIVACY_VERSION in server/users.mjs
export const PRIVACY_VERSION = '2026-09-24'

export function PrivacyStatement() {
  return (
    <div className="privacy-text">
      <p className="privacy-version">版本 {PRIVACY_VERSION}</p>
      <h3>保存什么、保存在哪</h3>
      <ul>
        <li><b>账户</b>：用户名、加盐哈希后的密码和登录状态，保存在运行 Personal World 服务的电脑上。</li>
        <li><b>照片、视频、事件和信息卡</b>：只保存在你这台设备的浏览器里，按账户分开存放，不上传到 Personal World 的服务器。</li>
      </ul>
      <h3>使用功能时会发送给第三方的内容</h3>
      <ul>
        <li><b>StepFun（阶跃星辰）</b>：事件分析和照片信息卡发送照片预览图（最长边 1200 像素）和元数据；人生管家发送事件的文字记录；按住说话发送录音；朗读发送回答文字。</li>
        <li><b>高德地图</b>：发送照片的定位坐标以识别城市，并加载地图。</li>
      </ul>
      <h3>照片里的敏感文字</h3>
      <p>同意本声明后，信息卡和事件分析会原样显示照片中可读的电话、证件号、门牌号等文字。不同意时这些号码会被遮挡。无论是否同意，都不会识别照片中人物的身份，也不会推测收入、健康、宗教或政治倾向。</p>
      <h3>你可以做什么</h3>
      <ul>
        <li>清除浏览器的站点数据，即可删除这台设备上的照片和记忆。</li>
        <li>删除账户目前需要联系服务的管理员。</li>
      </ul>
    </div>
  )
}
