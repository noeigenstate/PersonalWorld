# 现有地图素材工作流

## 已接入的两类素材

| 素材 | 清单/生产入口 | 加载入口 |
|---|---|---|
| OSM 地理瓦片档案 | `world-data/manifest.json`；`scripts/build-osm-region.mjs` | `server/worldData.mjs` 下载，`server/cartoonTiles.mjs` 优先读取本机 MBTiles |
| 卡通表面贴图 | `scripts/assets/generate-textures.mjs` | `public/world-assets/textures/<name>.png`，`src/map/cartoonWorld.ts` |

当前地理清单包含 `zhejiang-jiangsu.mbtiles`，585,506,816 字节，并记录 SHA-256。大文件不放 Git；托管在项目云端，地址通过 `.env` 的 `WORLD_DATA_URL` 配置，`{name}` 是文件名占位符。`npm run world:pull` 可拉取，服务启动也会后台同步，下载校验通过后替换本机文件。已有文件的启动检查目前只比大小，需要核验完整性时额外计算 SHA-256。

贴图脚本可以生成草、森林、水、悬崖、土、石、沙、田地和两种屋顶。当前地图实际读取 `grass`、`forest`、`water`、`sand`、`stone`、`cliff` 六种 PNG，把明暗细节结合统一色板使用。

**当前分发边界**：上述清单和自动下载器只覆盖 MBTiles，没有 PNG 的下载清单。不能把“有生成脚本”当作“贴图已托管并部署”。在新电脑验证前，必须取得已经生成的 PNG 或其真实云端地址；不要编造下载地址，也不要默认重新生成一套不同风格。

## 使用顺序

1. 先查最新 Git 和素材清单，核对本机 MBTiles、六种 PNG 及云端配置。已批准的远端素材优先；有资源就直接使用。
2. 地理文件缺失时执行 `npm run world:pull`；配置未提供时明确记录无法下载。当前会回退在线地理数据。
3. 将云端发布的 PNG 放入预期静态目录，浏览器应得到可解码的图片响应。开发服务器可能对缺失 PNG 返回 HTML，所以 HTTP 200 不能代表素材存在。
4. `npm run test:world` 检查地球、全国、城市和街道的真实地图链路；再查看实际截图，检查材质、岸线、水面、已有地标和回忆卡片。自动检查通过不等于已经看到了云端贴图。
5. 同地照片继续共用完整场景，特殊地标按 `landmark-refinement` 叠加。冲突若涉及用哪一套素材或覆盖已认可模型，列出具体画面与文件供用户评估。

只有确实需要新素材且明确采用本地生成路线时，才使用现有 ComfyUI 生成脚本；它依赖本机模型和服务，不是任何部署环境都有的运行时能力。发布新素材时同步保存可下载地址、大小、哈希和授权来源，并验证新机器恢复。当前不具备的 PNG 自动分发不可写成已完成。
