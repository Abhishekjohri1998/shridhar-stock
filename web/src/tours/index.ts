import type { Role } from '@stock/core';
import { billsTour, confirmTour, homeTour, inventoryTour, itemTour, purchasesTour, refillTour, reportsTour, setupTour, transfersTour } from './admin';
import { godownTour, tvTour, workerTour } from './staff';
import type { TourDef } from './types';

export type { Bi, TourDef, TourStep } from './types';

const ALL = [homeTour, reportsTour, billsTour, confirmTour, inventoryTour, itemTour, refillTour, purchasesTour, transfersTour, setupTour, workerTour, tvTour, godownTour];

export const TOURS: Record<string, TourDef> = Object.fromEntries(ALL.map((t) => [t.id, t]));

/** The tour for the screen at `path`, or null where there is none (the PIN page, help). */
export function tourForPath(path: string): string | null {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/admin') return 'home';
  if (p === '/admin/reports') return 'reports';
  if (p === '/admin/bills') return 'bills';
  if (p === '/admin/confirm') return 'confirm';
  if (p === '/admin/inventory' || p === '/admin/inventory-3d') return 'inventory';
  if (p.startsWith('/admin/inventory/')) return 'item';
  if (p === '/admin/refill') return 'refill';
  if (p === '/admin/purchases') return 'purchases';
  if (p === '/admin/transfers' || p === '/admin/deliveries') return 'transfers';
  if (['/admin/places', '/admin/people', '/admin/vehicles', '/admin/files', '/admin/settings'].includes(p)) return 'setup';
  if (p === '/worker' || p === '/worker/deliveries') return 'worker';
  if (p === '/worker/screen') return 'tv';
  if (p === '/worker/godown' || p === '/godown') return 'godown';
  return null;
}

/** The tour a person gets by themselves the first time they sign in, for their role. */
export const FIRST_TOUR: Partial<Record<Role, string>> = { admin: 'home', worker: 'worker', godown: 'worker' };

/** Where each tour's screen is, for "Show me" on the help page. */
export const TOUR_HOME: Record<string, string> = {
  home: '/admin',
  reports: '/admin/reports',
  bills: '/admin/bills',
  confirm: '/admin/confirm',
  inventory: '/admin/inventory',
  item: '/admin/inventory',
  refill: '/admin/refill',
  purchases: '/admin/purchases',
  transfers: '/admin/transfers',
  setup: '/admin/places',
  worker: '/worker',
  tv: '/worker/screen',
  godown: '/worker/godown',
};
