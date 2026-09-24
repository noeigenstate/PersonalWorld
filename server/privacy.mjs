// Deterministic masking for model output: privacy should not depend on the model following rules.
const LANDLINE = /(?<!\d)(0\d{2,3})[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/g
const MOBILE = /(?<!\d)(1[3-9]\d)\d{8}(?!\d)/g
const ID_CARD = /(?<!\d)(\d{2})\d{15}[\dXx](?!\d)/g

export function maskNumbers(text) {
  return text
    .replace(ID_CARD, (_, head) => `${head}${'*'.repeat(16)}`)
    .replace(MOBILE, (_, head) => `${head}********`)
    .replace(LANDLINE, (_, area) => `${area}-********`)
}

// Also catches numbers the model half-masked, e.g. "0571-5670 ****"
const PARTIAL = /(?<!\d)(0\d{2,3})[-\s]?\d{3,4}[-\s]?\*{2,}/g

export function maskDeep(value) {
  if (typeof value === 'string') return maskNumbers(value).replace(PARTIAL, (_, area) => `${area}-********`)
  if (Array.isArray(value)) return value.map(maskDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]))
  return value
}
