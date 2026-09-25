export interface LatLng { lat: number; lng: number }

export function wgs84ToGcj02(point: LatLng): LatLng
export function gcj02ToWgs84(point: LatLng): LatLng
export function distanceKm(a: LatLng, b: LatLng): number
export function centroid(points: LatLng[]): LatLng | undefined
