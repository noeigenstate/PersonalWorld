// Each account's photos and memories, kept on the disk of the computer that runs Personal World.
// The browser keeps a working copy (IndexedDB) and backs every change up here, so clearing the
// browser's site data no longer loses anything: signing in again restores from this vault.
//
//   <root>/<userId>/state.json          memory state without inline previews, plus preferences
//   <root>/<userId>/previews/<id>.jpg   preview images (the ones the app shows)
//   <root>/<userId>/originals/<id>      original files, with <id>.json holding name / type / time
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ASSET_ID = /^[A-Za-z0-9-]{8,64}$/

export function createAccountVault(root) {
  const dirOf = (user) => {
    if (!ASSET_ID.test(user.id)) throw new Error('账户编号无效')
    return join(root, user.id)
  }
  const checkId = (id) => { if (!ASSET_ID.test(id)) throw new Error('照片编号无效') }

  async function writeAtomic(path, data) {
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, data)
    await rename(temp, path)
  }

  async function exists(path) {
    try { await stat(path); return true } catch { return false }
  }

  return {
    async readState(user) {
      try {
        return JSON.parse(await readFile(join(dirOf(user), 'state.json'), 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return { memory: null, extras: {}, savedAt: null }
        throw error
      }
    },

    async writeState(user, body) {
      const memory = body?.memory
      if (!memory || !Array.isArray(memory.assets) || !Array.isArray(memory.events)) throw new Error('记忆数据格式不正确')
      // Previews are stored as files; never let them bloat state.json
      const assets = memory.assets.map(({ preview: _preview, ...asset }) => asset)
      // Preferences merge: a browser that lost its copy (site data cleared) must not wipe them
      const previous = await this.readState(user)
      const extras = { ...(previous.extras || {}), ...(body.extras && typeof body.extras === 'object' ? body.extras : {}) }
      const state = { memory: { ...memory, assets }, extras, savedAt: new Date().toISOString() }
      const dir = dirOf(user)
      await mkdir(dir, { recursive: true })
      await writeAtomic(join(dir, 'state.json'), JSON.stringify(state))
      return { savedAt: state.savedAt, assets: assets.length }
    },

    async listAssets(user) {
      const dir = dirOf(user)
      const names = async (sub) => (await readdir(join(dir, sub)).catch(() => []))
      const previews = (await names('previews')).filter((n) => n.endsWith('.jpg')).map((n) => n.slice(0, -4))
      const originals = (await names('originals')).filter((n) => !n.endsWith('.json') && !n.endsWith('.tmp'))
      return { previews, originals }
    },

    async putPreview(user, id, bytes) {
      checkId(id)
      if (!bytes.length) throw new Error('预览图为空')
      const dir = join(dirOf(user), 'previews')
      await mkdir(dir, { recursive: true })
      await writeAtomic(join(dir, `${id}.jpg`), bytes)
    },

    async putOriginal(user, id, bytes, meta) {
      checkId(id)
      if (!bytes.length) throw new Error('原图为空')
      const dir = join(dirOf(user), 'originals')
      await mkdir(dir, { recursive: true })
      await writeAtomic(join(dir, id), bytes)
      await writeAtomic(join(dir, `${id}.json`), JSON.stringify({ name: String(meta.name || id).slice(0, 255), type: String(meta.type || 'application/octet-stream').slice(0, 100), lastModified: Number(meta.lastModified) || Date.now() }))
    },

    async getPreview(user, id) {
      checkId(id)
      const path = join(dirOf(user), 'previews', `${id}.jpg`)
      return (await exists(path)) ? readFile(path) : null
    },

    async getOriginal(user, id) {
      checkId(id)
      const path = join(dirOf(user), 'originals', id)
      if (!(await exists(path))) return null
      const meta = JSON.parse(await readFile(`${path}.json`, 'utf8').catch(() => '{}'))
      return { bytes: await readFile(path), meta }
    },

    async removeAsset(user, id) {
      checkId(id)
      const dir = dirOf(user)
      await Promise.all([
        rm(join(dir, 'previews', `${id}.jpg`), { force: true }),
        rm(join(dir, 'originals', id), { force: true }),
        rm(join(dir, 'originals', `${id}.json`), { force: true }),
        rm(join(dir, 'spacetime', `${id}.glb`), { force: true }),
        rm(join(dir, 'spacetime', `${id}.json`), { force: true }),
      ])
    },

    // Spacetime scenes: the relief mesh reconstructed from a photo, kept next to it (spacetime/<id>.glb)
    async putScene(user, id, bytes, meta) {
      checkId(id)
      if (!bytes.length) throw new Error('模型为空')
      const dir = join(dirOf(user), 'spacetime')
      await mkdir(dir, { recursive: true })
      await writeAtomic(join(dir, `${id}.glb`), bytes)
      await writeAtomic(join(dir, `${id}.json`), JSON.stringify({ ...meta, bytes: bytes.length, createdAt: new Date().toISOString() }))
    },

    // `version`: only a model saved under this reconstruction version counts (older ones are rebuilt)
    async getScene(user, id, version) {
      checkId(id)
      const path = join(dirOf(user), 'spacetime', `${id}.glb`)
      if (!(await exists(path))) return null
      const meta = JSON.parse(await readFile(`${path.slice(0, -4)}.json`, 'utf8').catch(() => '{}'))
      if (version !== undefined && meta.version !== version) return null
      return { bytes: await readFile(path), meta }
    },

    async listScenes(user, version) {
      const dir = join(dirOf(user), 'spacetime')
      const ids = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.glb')).map((n) => n.slice(0, -4))
      if (version === undefined) return ids
      const current = []
      for (const id of ids) {
        const meta = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8').catch(() => '{}'))
        if (meta.version === version) current.push(id)
      }
      return current
    },
  }
}
