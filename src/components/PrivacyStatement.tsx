// Keep in sync with PRIVACY_VERSION in server/users.mjs
export const PRIVACY_VERSION = '2026-09-25'

export function PrivacyStatement() {
  return (
    <div className="privacy-text">
      <p className="privacy-version">版本 {PRIVACY_VERSION}</p>
      <h3>保存什么、保存在哪</h3>
      <ul>
        <li><b>账户</b>：用户名、加盐哈希后的密码和登录状态，保存在运行 Personal World 服务的电脑上。</li>
        <li><b>照片、视频、事件和信息卡</b>：按账户保存在这台设备的浏览器里。分析照片时，图片会临时经 Personal World 服务转发给 StepFun；服务不持久保存图片。</li>
      </ul>
      <h3>使用功能时会发送给第三方的内容</h3>
      <ul>
        <li><b>StepFun（阶跃星辰）</b>：导入或再次打开后，默认自动逐张生成照片信息卡，可在地图上暂停；信息卡发送从原图缩放的 JPEG（最长边 2560 像素，失败时用预览图）及元数据。手动分析事件时发送最多 6 张最长边约 1200 像素的预览图；人生管家发送事件文字，语音功能发送录音或回答文字。</li>
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
