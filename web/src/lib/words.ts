/**
 * Status words for every screen, in both languages. One place, so a transfer is "sent" on the
 * godown's phone and on the admin's screen alike.
 */
export const STATUS: Record<string, [en: string, kn: string]> = {
  requested: ['Asked for', 'ಕೇಳಲಾಗಿದೆ'],
  sent: ['On the way', 'ದಾರಿಯಲ್ಲಿದೆ'],
  received: ['Received', 'ತಲುಪಿದೆ'],
  cancelled: ['Cancelled', 'ರದ್ದು'],
  ordered: ['Ordered', 'ಆರ್ಡರ್ ಮಾಡಲಾಗಿದೆ'],
  confirmed: ['Confirmed', 'ಒಪ್ಪಿಗೆ'],
  dispatched: ['Dispatched', 'ಕಳುಹಿಸಲಾಗಿದೆ'],
  pending: ['To go', 'ಹೋಗಬೇಕು'],
  out: ['Out now', 'ದಾರಿಯಲ್ಲಿ'],
  delivered: ['Delivered', 'ತಲುಪಿಸಲಾಗಿದೆ'],
  failed: ['Not delivered', 'ತಲುಪಿಸಲಾಗಲಿಲ್ಲ'],
  new: ['New', 'ಹೊಸದು'],
  done: ['Billed', 'ಬಿಲ್ ಆಯಿತು'],
  declined: ['Declined', 'ನಿರಾಕರಿಸಲಾಗಿದೆ'],
  'typed-match': ['Typed, matched', 'ಟೈಪ್, ಹೊಂದಿದೆ'],
  'read-auto': ['Handwriting read', 'ಕೈಬರಹ ಓದಲಾಗಿದೆ'],
  'to-confirm': ['To digitise', 'ಡಿಜಿಟೈಸ್ ಮಾಡಬೇಕು'],
  confirmedLine: ['Digitised', 'ಡಿಜಿಟೈಸ್ ಆಗಿದೆ'],
  'not-item': ['Not stock', 'ಸ್ಟಾಕ್ ಅಲ್ಲ'],
};

export function statusWord(s: string, lang: 'en' | 'kn', line = false): string {
  const w = STATUS[line && s === 'confirmed' ? 'confirmedLine' : s];
  return w ? (lang === 'kn' ? w[1] : w[0]) : s;
}
