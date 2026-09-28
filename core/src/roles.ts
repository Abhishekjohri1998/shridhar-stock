import type { Role } from './types';

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  owner: '/owner',
  worker: '/worker',
  godown: '/godown',
  vendor: '/vendor',
  delivery: '/delivery',
  customer: '/customer',
};

/** Roles whose `linkedId` must point at something, and at what. */
export const ROLE_LINK: Partial<Record<Role, 'location' | 'supplier' | 'customer'>> = {
  godown: 'location',
  vendor: 'supplier',
};

/** PINs are 4 to 6 digits: typed on a phone keypad, often in a hurry. */
export function checkPin(pin: string): string | null {
  return /^\d{4,6}$/.test(String(pin ?? '')) ? null : 'The PIN is 4 to 6 digits';
}
