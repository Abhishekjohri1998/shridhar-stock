import { ACTIVE_ROLES, type Role } from './types';

/** Where each role lands after signing in. Removed roles do not sign in; they land on the login. */
export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  worker: '/worker',
  godown: '/godown',
  owner: '/',
  vendor: '/',
  delivery: '/',
  customer: '/',
};

/** Roles whose `linkedId` must point at something, and at what. */
export const ROLE_LINK: Partial<Record<Role, 'location' | 'supplier' | 'customer'>> = {
  godown: 'location',
  vendor: 'supplier',
};

/** Whether a role still signs in. Owner, vendor, delivery and customer logins are no longer used. */
export function isActiveRole(role: string): boolean {
  return (ACTIVE_ROLES as readonly string[]).includes(role);
}

/**
 * The message for a login whose role was removed, in English and Kannada. Said plainly, since the
 * PIN was right: the person should ask the shop to move them to a role that is kept.
 */
export function retiredRoleMessage(role: string): string {
  if (role === 'vendor') {
    return 'Suppliers no longer sign in here. Call the shop about your orders. / ಸರಬರಾಜುದಾರರು ಇಲ್ಲಿ ಲಾಗಿನ್ ಆಗುವುದಿಲ್ಲ. ನಿಮ್ಮ ಆರ್ಡರ್ ಬಗ್ಗೆ ಅಂಗಡಿಗೆ ಕರೆ ಮಾಡಿ.';
  }
  return 'This login is no longer used. Ask the shop admin to move you to another role. / ಈ ಲಾಗಿನ್ ಈಗ ಬಳಕೆಯಲ್ಲಿಲ್ಲ. ಬೇರೆ ಪಾತ್ರಕ್ಕೆ ಬದಲಿಸಲು ಅಂಗಡಿಯ ಆಡ್ಮಿನ್ ಅವರನ್ನು ಕೇಳಿ.';
}

/** PINs are 4 to 6 digits: typed on a phone keypad, often in a hurry. */
export function checkPin(pin: string): string | null {
  return /^\d{4,6}$/.test(String(pin ?? '')) ? null : 'The PIN is 4 to 6 digits';
}
