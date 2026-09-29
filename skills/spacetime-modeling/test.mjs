import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, importRoot, live, root } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const viewer = read('src/components/SpacetimeScene.tsx')
const server = read('server/spacetimeScene.mjs')

test('SKILL.md 格式完整，写明能力边界、坐标约定、查看器规则、失败模式和验收', () => {
  const { body } = checkSkillFile(dir)
  for (const text of ['单张照片的 2.5D 浮雕', '只有从拍照的位置看才是对的', '不能"漫游"', '走拍视频', '看向 −z，y 向上', '0.7 × 图宽', '不要用顶点的平均方向当光轴',
    '禁用缩放和平移', '垫**原照片**', '必须升 `RELIEF_VERSION`', '时间片之间不插值', '必须看图', 'discontinuity_threshold']) assert.ok(body.includes(text), `缺少 ${text}`)
})

test('重建工作流用 DA3 单目节点：抠天空、贴原图、深度跳变上限放宽到 0.12', async () => {
  const { RELIEF_VERSION } = await importRoot('server/spacetimeScene.mjs')
  assert.ok(Number.isInteger(RELIEF_VERSION) && RELIEF_VERSION >= 2, '重建方式改过（跳变上限、查看器），版本至少是 2')
  for (const node of ['LoadDA3Model', 'DA3Inference', 'DA3GeometryToMesh', 'SaveGLB']) assert.ok(server.includes(node), `工作流缺少 ${node}`)
  assert.match(server, /mode: 'mono'/)
  assert.match(server, /use_sky_mask: true/)
  assert.match(server, /texture: true/)
  const jump = server.match(/discontinuity_threshold: Number\(process\.env\.DA3_DISCONTINUITY\) \|\| ([\d.]+)/)
  assert.ok(jump && Number(jump[1]) >= 0.1 && Number(jump[1]) <= 0.2, '掠射的地面要保留，又不能让真正的遮挡边缘被拉成条带')
})

test('查看器守住规则：真实光轴、DA3 内参、小角度摆动、禁缩放、垫底原照片、不再绕包围盒转', () => {
  assert.match(viewer, /HALF_TAN_X = 0\.5 \/ 0\.7/, '视场角来自 DA3 的固定内参 fx = 0.7 × 宽')
  const sway = viewer.match(/SWAY = \{ azimuth: ([\d.]+), polar: ([\d.]+) \}/)
  assert.ok(sway, '摆动范围写成 SWAY 常量')
  assert.ok(Number(sway[1]) <= 0.06 && Number(sway[2]) <= 0.04, `单张浮雕只允许两三度摆动：${sway[0]}`)
  assert.match(viewer, /new THREE\.Vector3\(0, 0, -1\)/, '光轴是 −z')
  assert.match(viewer, /-p\.z/, '深度取 −z')
  assert.match(viewer, /controls\.enableZoom = false/)
  assert.match(viewer, /controls\.enablePan = false/)
  assert.match(viewer, /camera\.position\.set\(0, 0, 0\)/, '相机留在拍照的位置')
  assert.match(viewer, /const soft = document\.createElement\('canvas'\)/, '照片以外是整张照片的虚化')
  assert.ok(!/Box3\(\)\.setFromObject/.test(viewer) && !/getCenter\(/.test(viewer), '不再以包围盒中心为轨道中心')
  assert.ok(!/minDistance|maxDistance/.test(viewer), '不再允许拉近或拉远')
  assert.match(viewer, /keepFacing\(/, '剔掉沿视线方向的拉伸三角形')
  assert.match(viewer, /squeezeDepth\(/, '压缩深度范围')
  const gamma = viewer.match(/DEPTH_GAMMA = ([\d.]+)/)
  assert.ok(gamma && Number(gamma[1]) > 0 && Number(gamma[1]) <= 0.7, `深度压缩指数：${gamma?.[0]}`)
  assert.match(viewer, /frameAspect/, '画布就是照片的画幅')
  assert.match(viewer, /inpaint\(/, '垫底照片里被浮雕遮住的部分要补成柔和的底色')
})

test('网格清理：剔掉沿视线方向的拉伸三角形，保留正对相机的', async () => {
  const { keepFacing } = await importRoot('src/lib/reliefMesh.ts')
  // 相机在原点看向 −z。三角形 A 正对相机（在 z = −5 的平面上）；B 沿视线方向拉长（人物与身后地面之间的连接面）
  const positions = new Float32Array([
    -1, -1, -5, 1, -1, -5, 0, 1, -5,       // A
    -0.1, 0, -3, -0.1, 0.05, -3, -0.1, 0, -9, // B: 在 x = −0.1 的竖直平面上，沿 z 拉长（几乎与视线平行）
    0, 0, 0, 1, 0, 0, 0, 1, 0,             // 贴着原点的三角形，法线与视线垂直
  ])
  assert.deepEqual([...keepFacing(positions, null, 0.05)], [0, 1, 2], '只留下正对相机的三角形')
  assert.deepEqual([...keepFacing(positions, new Uint32Array([0, 1, 2, 3, 4, 5]), 0.05)], [0, 1, 2], '带索引时一样')
})

test('压缩深度：沿各自的视线移动顶点，首视图不变，近处推远、远处拉近，中位深度不动', async () => {
  const { squeezeDepth } = await importRoot('src/lib/reliefMesh.ts')
  const positions = new Float32Array([0.3, -0.2, -2, 1, 1, -8, 0.5, 0.5, -4])
  const before = [...positions]
  const squeeze = squeezeDepth(positions, 4, 0.5)
  assert.ok(Math.abs(positions[8] + 4) < 1e-6 && Math.abs(positions[6] - 0.5) < 1e-6, '中位深度处的点不动')
  assert.ok(-positions[2] > 2 && -positions[2] < 4, '近处的点被推远，但没有越过中位深度')
  assert.ok(-positions[5] < 8 && -positions[5] > 4, '远处的点被拉近')
  for (let i = 0; i < 9; i += 3) assert.ok(Math.abs(positions[i] / positions[i + 2] - before[i] / before[i + 2]) < 1e-6 && Math.abs(positions[i + 1] / positions[i + 2] - before[i + 1] / before[i + 2]) < 1e-6, '每个点仍在自己的视线上：从原点看位置不变')
  assert.ok(Math.abs(squeeze(4) - 4) < 1e-9 && Math.abs(squeeze(1) - 2) < 1e-9, '返回的函数给出压缩后的深度')
})

test('垫底照片补洞：只补被遮住的内部，用周围没被遮住的颜色，其余像素原样', async () => {
  const { inpaint, dilate } = await importRoot('src/lib/reliefMesh.ts')
  const w = 32, h = 32
  const rgba = new Uint8ClampedArray(w * h * 4)
  const covered = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4, inside = x >= 12 && x < 20 && y >= 12 && y < 20
    covered[y * w + x] = inside ? 1 : 0
    // 周围是绿色；被遮住的地方是一个红色的"人"
    rgba[p] = inside ? 255 : 0; rgba[p + 1] = inside ? 0 : 200; rgba[p + 2] = 0; rgba[p + 3] = 255
  }
  const filled = inpaint(rgba, covered, w, h, 8)
  const at = (x, y) => [filled[(y * w + x) * 4], filled[(y * w + x) * 4 + 1]]
  assert.deepEqual(at(2, 2), [0, 200], '没被遮住的像素原样')
  const [r, g] = at(15, 15)
  assert.ok(r < 10 && g > 190, `被遮住的红色人形被周围的绿色补上：${r},${g}`)
  const grown = dilate(covered, w, h, 1)
  assert.equal(grown[12 * w + 11], 1)
  assert.equal(grown[12 * w + 10], 0)
})

test('账户里的模型带版本：旧版本当作不存在，列表只给当前版本，删照片时一并删除', async () => {
  const { createAccountVault } = await importRoot('server/accountVault.mjs')
  const vault = createAccountVault(mkdtempSync(join(tmpdir(), 'pw-relief-')))
  const user = { id: 'user-relief-0001' }
  const glb = Buffer.from('glTF fixture')
  await vault.putScene(user, 'photo-old-0001', glb, { photoId: 'photo-old-0001', version: 1 })
  await vault.putScene(user, 'photo-new-0001', glb, { photoId: 'photo-new-0001', version: 2 })
  assert.equal(await vault.getScene(user, 'photo-old-0001', 2), null, '版本 1 的模型在版本 2 下要重建')
  assert.ok(await vault.getScene(user, 'photo-old-0001', 1))
  assert.equal((await vault.getScene(user, 'photo-new-0001', 2)).bytes.toString(), 'glTF fixture')
  assert.deepEqual(await vault.listScenes(user, 2), ['photo-new-0001'])
  assert.deepEqual((await vault.listScenes(user)).sort(), ['photo-new-0001', 'photo-old-0001'])
  await vault.removeAsset(user, 'photo-new-0001')
  assert.equal(await vault.getScene(user, 'photo-new-0001'), null, '删照片时模型一并删除')
})

// A minimal GLB reader: positions, uvs and the index count of the first primitive
function readGlb(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF')
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
  const bin = 20 + jsonLength + 8
  const primitive = json.meshes[0].primitives[0]
  const floats = (accessorIndex, width) => {
    const accessor = json.accessors[accessorIndex], view = json.bufferViews[accessor.bufferView]
    const at = bin + (view.byteOffset || 0) + (accessor.byteOffset || 0)
    return new Float32Array(buffer.buffer.slice(buffer.byteOffset + at, buffer.byteOffset + at + accessor.count * width * 4))
  }
  return { positions: floats(primitive.attributes.POSITION, 3), uvs: floats(primitive.attributes.TEXCOORD_0, 2), triangles: json.accessors[primitive.indices].count / 3 }
}

test('真实重建：本机 ComfyUI 生成的网格符合查看器依赖的约定（LIVE=1）', { skip: !live }, async () => {
  const { reconstructRelief, reliefCapability } = await importRoot('server/spacetimeScene.mjs')
  const comfy = process.env.COMFY_URL || 'http://127.0.0.1:8188'
  const capability = await reliefCapability({ comfy })
  if (!capability.available) { console.log(`跳过：${capability.reason}`); return }
  const glb = await reconstructRelief(readFileSync(join(dir, 'evals/2026-09-29/images/bridge.jpg')), { comfy })
  const { positions, uvs, triangles } = readGlb(glb)
  const count = positions.length / 3
  let edge = 0
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], z = positions[i * 3 + 2]
    assert.ok(z < 0, `相机看向 −z：顶点 ${i} 的 z = ${z}`)
    edge = Math.max(edge, Math.abs(x / z))
  }
  assert.ok(edge > 0.6 && edge < 0.73, `画面左右边缘的 |x/z| 应约为 0.714（fx = 0.7 × 宽），实际最大 ${edge.toFixed(3)}`)
  // Top of the picture (small v) is up (large y): v and the height in the picture plane (y / depth)
  // are strongly anti-correlated. (The sky is cut out, so compare across all vertices, not the top strip.)
  let sumV = 0, sumH = 0
  const heights = new Float64Array(count)
  for (let i = 0; i < count; i++) { heights[i] = positions[i * 3 + 1] / -positions[i * 3 + 2]; sumV += uvs[i * 2 + 1]; sumH += heights[i] }
  const meanV = sumV / count, meanH = sumH / count
  let cov = 0, varV = 0, varH = 0
  for (let i = 0; i < count; i++) { const dv = uvs[i * 2 + 1] - meanV, dh = heights[i] - meanH; cov += dv * dh; varV += dv * dv; varH += dh * dh }
  const correlation = cov / Math.sqrt(varV * varH)
  assert.ok(correlation < -0.9, `图像越靠上（v 小）顶点越高：相关系数 ${correlation.toFixed(3)}`)
  assert.ok(uvs.every((u) => u >= -1e-4 && u <= 1 + 1e-4), '纹理坐标在 0–1')
  assert.ok(triangles > 20_000 && triangles < 1_000_000, `三角形数在预算内：${triangles}`)
  assert.ok(glb.length < 40 * 1024 * 1024, `GLB 不超过 40 MB：${glb.length}`)
})
