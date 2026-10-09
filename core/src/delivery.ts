import type { DeliveryStatus, ShopSettings, TrackPoint, VehicleKind } from './types';

/**
 * Home deliveries: which vehicle, how far, and what of the route is kept.
 */

/** The rule from Setup → Settings: at most N item lines and ₹X goes by bike, anything bigger by 4-wheeler. */
export function suggestVehicle(order: { itemCount: number; amount: number }, rule: Pick<ShopSettings, 'bikeMaxItems' | 'bikeMaxAmount'>): VehicleKind {
  return order.itemCount <= rule.bikeMaxItems && order.amount <= rule.bikeMaxAmount ? 'bike' : 'car';
}

/** Straight-line distance in km between two points on the earth (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "850 m" or "3.4 km". */
export function distanceText(km: number): string {
  return km < 1 ? Math.round(km * 1000 / 10) * 10 + ' m' : (Math.round(km * 10) / 10).toFixed(1) + ' km';
}

/** The most points a route keeps while on the way: about 80 minutes at one every 10 seconds. */
export const TRACK_MAX = 500;

/** Adds a point to the route, dropping the oldest (but never the start) once it is long. */
export function addTrackPoint(track: TrackPoint[] | undefined, p: TrackPoint, max = TRACK_MAX): TrackPoint[] {
  const t = [...(track ?? []), p];
  if (t.length <= max) return t;
  return [t[0]!, ...t.slice(t.length - max + 1)];
}

/** Once a delivery is over only where it started and ended are kept: the route itself is not stored. */
export function trimTrack(track: TrackPoint[] | undefined): TrackPoint[] {
  if (!track || track.length === 0) return [];
  if (track.length === 1) return [track[0]!];
  return [track[0]!, track[track.length - 1]!];
}

/** Still to be delivered: assigned or on the way. */
export const isActiveDelivery = (s: DeliveryStatus) => s === 'pending' || s === 'out';

/** Whether a reported position is a real place on the earth. */
export const validLatLng = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Within this many metres of the home the worker is "Nearby". */
export const NEARBY_M = 300;

/** Whether a position is within NEARBY_M of the home. */
export function isNearby(pos: { lat: number; lng: number } | undefined | null, home: { lat?: number; lng?: number }): boolean {
  if (!pos || home.lat == null || home.lng == null) return false;
  return distanceKm(pos, { lat: home.lat, lng: home.lng }) * 1000 <= NEARBY_M;
}

/** A 4-digit code for the door, from a random source (0..1). */
export function makeOtp(rand: () => number = Math.random): string {
  return String(Math.floor(rand() * 10000) % 10000).padStart(4, '0');
}

/** Wrong codes allowed before the worker must call the shop. */
export const OTP_MAX_TRIES = 5;

export type DeliveryStepKey = 'packed' | 'picked' | 'onway' | 'nearby' | 'delivered';
export interface DeliveryStep {
  key: DeliveryStepKey;
  /** When it happened, if it has. */
  at?: string;
  done: boolean;
  /** The step happening now. */
  active: boolean;
}

/**
 * The customer's timeline: Order packed → Picked up → On the way → Nearby → Delivered, from the
 * times already kept. "Picked up" and "On the way" both happen at Start.
 */
export function deliverySteps(d: { status: DeliveryStatus; times: Partial<Record<DeliveryStatus, string>>; nearbyAt?: string }): DeliveryStep[] {
  const t = d.times;
  const ats: [DeliveryStepKey, string | undefined][] = [
    ['packed', t.pending],
    ['picked', t.out],
    ['onway', t.out],
    ['nearby', d.nearbyAt],
    ['delivered', t.delivered],
  ];
  let active = -1;
  if (d.status === 'pending') active = 0;
  else if (d.status === 'out') active = d.nearbyAt ? 3 : 2;
  const over = d.status === 'delivered';
  return ats.map(([key, at], i) => ({ key, ...(at ? { at } : {}), done: over ? i < 4 || !!at : i < active, active: i === active }));
}
