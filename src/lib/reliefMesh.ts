// Clean-up for the 3D relief of one photo (SpacetimeScene): pure functions on typed arrays, so they
// can be tested without a browser. The mesh is in the reconstruction's frame: the camera at the origin.

/**
 * Keeps the triangles that face the camera: the angle between a triangle's normal and the ray to its
 * centre must not be too grazing (|cos| ≥ minCos).
 *
 * Where a person stands in front of the ground, the depth jumps from the body to the ground behind it,
 * and the triangles bridging the jump lie along the view ray: seen from the side they are long
 * smeared sheets (the feet stretched onto the ground, a second body). Far ground is grazing too, but
 * it barely moves when the eye sways, and the photo behind the relief shows it just as it was.
 */
export function keepFacing(positions: ArrayLike<number>, indices: ArrayLike<number> | null, minCos: number): Uint32Array {
  const count = indices ? indices.length : Math.floor(positions.length / 3)
  const kept: number[] = []
  for (let i = 0; i + 2 < count; i += 3) {
    const a = indices ? indices[i] : i, b = indices ? indices[i + 1] : i + 1, c = indices ? indices[i + 2] : i + 2
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
    const e1x = positions[b * 3] - ax, e1y = positions[b * 3 + 1] - ay, e1z = positions[b * 3 + 2] - az
    const e2x = positions[c * 3] - ax, e2y = positions[c * 3 + 1] - ay, e2z = positions[c * 3 + 2] - az
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
    const normal = Math.hypot(nx, ny, nz)
    if (normal < 1e-12) continue // degenerate
    const cx = (ax + positions[b * 3] + positions[c * 3]) / 3, cy = (ay + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3, cz = (az + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3
    const ray = Math.hypot(cx, cy, cz)
    if (ray < 1e-12) continue
    if (Math.abs(nx * cx + ny * cy + nz * cz) / (normal * ray) >= minCos) kept.push(a, b, c)
  }
  return Uint32Array.from(kept)
}

/** Grows a mask by `radius` pixels (a square structuring element, done in two passes) */
export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask
  const across = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let hit = 0
    for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius) && !hit; k++) hit = mask[y * width + k]
    across[y * width + x] = hit
  }
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let hit = 0
    for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius) && !hit; k++) hit = across[k * width + x]
    out[y * width + x] = hit
  }
  return out
}

/**
 * The photo with the covered pixels (where the relief stands in front of it) replaced by a soft fill
 * made of the uncovered pixels around them. Behind the relief the eye then finds a smooth colour where
 * something used to stand, not a second sharp copy of it. RGBA in, RGBA out; uncovered pixels are untouched.
 */
export function inpaint(rgba: Uint8ClampedArray, covered: Uint8Array, width: number, height: number, cell = 16): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell)
  const sum = new Float32Array(gw * gh * 3), weight = new Float32Array(gw * gh)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (covered[y * width + x]) continue
    const g = Math.floor(y / cell) * gw + Math.floor(x / cell), p = (y * width + x) * 4
    sum[g * 3] += rgba[p]; sum[g * 3 + 1] += rgba[p + 1]; sum[g * 3 + 2] += rgba[p + 2]; weight[g]++
  }
  const color = new Float32Array(gw * gh * 3)
  let known = new Uint8Array(gw * gh)
  let unknown = 0
  for (let g = 0; g < gw * gh; g++) {
    if (weight[g] > 0) { known[g] = 1; for (let k = 0; k < 3; k++) color[g * 3 + k] = sum[g * 3 + k] / weight[g] } else unknown++
  }
  if (unknown === gw * gh) return out // nothing uncovered to learn from
  // Diffuse the known colours into the unknown cells, one ring per pass
  for (let pass = 0; unknown > 0 && pass < gw + gh; pass++) {
    const next = new Uint8Array(known)
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const g = gy * gw + gx
      if (known[g]) continue
      let n = 0, r = 0, gr = 0, b = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = gx + dx, y = gy + dy
        if (x < 0 || y < 0 || x >= gw || y >= gh || !known[y * gw + x]) continue
        const h = y * gw + x; r += color[h * 3]; gr += color[h * 3 + 1]; b += color[h * 3 + 2]; n++
      }
      if (n) { color[g * 3] = r / n; color[g * 3 + 1] = gr / n; color[g * 3 + 2] = b / n; next[g] = 1; unknown-- }
    }
    known = next
  }
  // Covered pixels take the cell grid's colour, interpolated between cell centres
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!covered[y * width + x]) continue
    const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5)), fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5))
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0
    const p = (y * width + x) * 4
    for (let k = 0; k < 3; k++) {
      const top = color[(y0 * gw + x0) * 3 + k] * (1 - tx) + color[(y0 * gw + x1) * 3 + k] * tx
      const bottom = color[(y1 * gw + x0) * 3 + k] * (1 - tx) + color[(y1 * gw + x1) * 3 + k] * tx
      out[p + k] = top * (1 - ty) + bottom * ty
    }
  }
  return out
}

/**
 * Squeezes the depth range towards the median: depth → median × (depth / median)^gamma, moving each
 * vertex along its own ray from the camera. Seen from the origin nothing changes (a vertex stays on
 * its ray), but the near geometry — where a small sway moves things the most, and where a single
 * photo knows the least — is pushed away and the far geometry pulled in, so parallax stays modest
 * and what a sway uncovers stays small. Works in place on x, y, z triples (camera at the origin
 * looking down −z); returns the compressed depth of a given depth for callers that track it.
 */
export function squeezeDepth(positions: { [index: number]: number; length: number }, median: number, gamma: number): (depth: number) => number {
  const squeeze = (depth: number) => median * Math.pow(depth / median, gamma)
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const depth = -positions[i + 2]
    if (!(depth > 1e-9)) continue
    const k = squeeze(depth) / depth
    positions[i] *= k; positions[i + 1] *= k; positions[i + 2] *= k
  }
  return squeeze
}
