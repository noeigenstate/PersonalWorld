import type { SceneData } from './styledDistrict'

// A successful fetch is not a finished scene or a likeness review. This is only
// a conservative source-data flag, not an estimated percentage of the real world.
export function sceneCoverage(data: Pick<SceneData, 'buildings' | 'detailStatus'>) {
  const buildings = data.buildings.length
  const needsDetail = buildings < 50 || data.detailStatus === 'unavailable'
  return { buildings, needsDetail,
    level: buildings === 0 ? 'no-buildings' as const : needsDetail ? 'partial' as const : 'mapped' as const,
    note: buildings === 0 ? '尚无建筑轮廓，当前仅呈现已有的道路、水面与植被'
      : needsDetail ? '建筑资料不完整，部分楼体仍使用地图原貌'
        : '使用已取得的地理轮廓；普通楼体为通用卡通造型' }
}
