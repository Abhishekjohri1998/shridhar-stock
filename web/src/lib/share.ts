import type { PaidBy } from '@stock/core';

/**
 * The customer's links, shared by hand through WhatsApp (wa.me needs no account or paid API):
 * the admin or worker taps, WhatsApp opens with the message ready, they press send.
 */
export const linkUrl = (path: string) => window.location.origin + path;

/** https://wa.me/91<10 digits>?text=…, or WhatsApp's own "pick a chat" when there is no phone. */
export function waLink(phone: string, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10);
  return 'https://wa.me/' + (digits.length === 10 ? '91' + digits : '') + '?text=' + encodeURIComponent(text);
}

/** The tracking message, in both languages so it reads right whoever opens it. */
export function trackMessage(shop: string, path: string, otp?: string): string {
  const url = linkUrl(path);
  return (
    (shop ? shop + ': ' : '') +
    'Your order is on its way. Follow it live: ' +
    url +
    (otp ? '\nTell this code to the delivery person: ' + otp : '') +
    '\n\nನಿಮ್ಮ ಆರ್ಡರ್ ಬರುತ್ತಿದೆ. ನೇರವಾಗಿ ನೋಡಿ: ' +
    url +
    (otp ? '\nಡೆಲಿವರಿಯವರಿಗೆ ಈ ಕೋಡ್ ಹೇಳಿ: ' + otp : '')
  );
}

export function locateMessage(shop: string, path: string): string {
  const url = linkUrl(path);
  return (
    (shop ? shop + ': ' : '') +
    'Please send your location for the delivery, with one tap: ' +
    url +
    '\n\nಡೆಲಿವರಿಗಾಗಿ ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಒಂದೇ ಒತ್ತಿನಲ್ಲಿ ಕಳುಹಿಸಿ: ' +
    url
  );
}

/** Copies text, falling back to the old way inside a WebView without the clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** "4:32 pm". */
export const clockText = (iso: string | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

/** How the customer paid, in words. */
export function paidWord(p: PaidBy, bi: (en: string, kn: string) => string): string {
  return p === 'cash' ? bi('Cash', 'ನಗದು') : p === 'upi' ? 'UPI' : p === 'paid' ? bi('Already paid', 'ಮೊದಲೇ ಪಾವತಿ') : bi('Credit (udhaar)', 'ಸಾಲ (ಉದ್ರಿ)');
}

/** Opens a link in a new tab (WhatsApp); inside the app's WebView the app hands wa.me to WhatsApp. */
export function openLink(url: string, w?: Window | null): void {
  if (w) w.location.href = url;
  else window.open(url, '_blank', 'noopener');
}

