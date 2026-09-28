// Map data files (world-data/*.mbtiles) are kept on Seafile, not in git.
//   node scripts/world-data.mjs manifest   list the local files with size and SHA-256 → world-data/manifest.json
//                                          (run after building; commit the manifest, upload the files)
//   node scripts/world-data.mjs pull       download what the manifest lists and this computer lacks
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256, syncWorldData, worldDataDir } from '../server/worldData.mjs'

process.loadEnvFile?.(new URL('../.env', import.meta.url))
const command = process.argv[2]
if (command === 'manifest') {
  const files = []
  for (const name of (await readdir(worldDataDir)).filter((n) => n.endsWith('.mbtiles')).sort()) {
    const path = join(worldDataDir, name)
    const { size } = await stat(path)
    console.log(`${name}：${(size / 1048576).toFixed(0)} MB，计算校验值…`)
    files.push({ name, size, sha256: await sha256(path) })
  }
  await writeFile(join(worldDataDir, 'manifest.json'), JSON.stringify({ updated: new Date().toISOString().slice(0, 10), files }, null, 2) + '\n')
  console.log(`已写入 world-data/manifest.json（${files.length} 个文件，共 ${(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(0)} MB）。把这些文件上传到 Seafile 的同一个文件夹。`)
} else if (command === 'pull') {
  const done = await syncWorldData()
  console.log(done.length ? `已下载：${done.join('、')}` : '没有需要下载的文件')
} else {
  console.log('用法：node scripts/world-data.mjs manifest | pull')
}
