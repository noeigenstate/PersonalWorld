import type { MapPhoto } from './scene'

export type SceneTheme = 'beach' | 'icecream' | 'classroom' | 'concert' | 'driving' | 'reading' | 'dining' | 'park'
export interface SceneRecipe {
  theme: SceneTheme
  label: string
  sourcePhotoIds: string[]
  anchor: [number, number]
}

const themes: { theme: SceneTheme; label: string; pattern: RegExp }[] = [
  { theme: 'beach', label: '海边', pattern: /海滩|沙滩|海边|海岸|beach|seaside/i },
  { theme: 'icecream', label: '冰淇淋', pattern: /冰淇淋|冰激凌|雪糕|gelato|ice\s*cream/i },
  { theme: 'classroom', label: '课堂', pattern: /上课|课堂|教室|课桌|校园|学校|classroom|school/i },
  { theme: 'concert', label: '演出', pattern: /演唱会|音乐会|舞台|演出|concert|live\s*show/i },
  { theme: 'driving', label: '自驾', pattern: /开车|自驾|驾驶|车内|驾车|road\s*trip/i },
  { theme: 'reading', label: '阅读', pattern: /绘本|读书|阅读|书店|图书馆|亲子共读|bookshop|library/i },
  { theme: 'dining', label: '美食', pattern: /餐厅|吃饭|美食|咖啡|甜品|用餐|restaurant|cafe/i },
  { theme: 'park', label: '公园', pattern: /公园|野餐|游乐场|踏青|picnic|playground/i },
]

// A recipe is a rendering instruction inferred from the private cards in one photo region.
// Generic guesses such as “travel” never choose a venue or overwrite mapped geography.
export function recipeForPhotos(photos: MapPhoto[], preferredId?: string): SceneRecipe | null {
  const scored = themes.map((item, order) => {
    const matches = photos.filter((photo) => {
      const card = photo.sceneCard
      if (!card) return false
      return [card.title, card.scene, card.caption, ...(card.tags || []), card.eventGuess?.type || '']
        .some((text) => item.pattern.test(text || ''))
    })
    return { ...item, matches, order }
  }).filter((item) => item.matches.length)
    .sort((a, b) => b.matches.length - a.matches.length || a.order - b.order)
  const best = scored[0]
  if (!best) return null
  return {
    theme: best.theme,
    label: best.label,
    sourcePhotoIds: best.matches.map((photo) => photo.id),
    anchor: (best.matches.find((photo) => photo.id === preferredId) || best.matches[0]).gcj,
  }
}
