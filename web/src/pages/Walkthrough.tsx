import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_HOME, type MsgKey, type Role } from '@stock/core';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useBi } from '../components/ui';

const ROLE_WHAT: Record<Role, [string, string]> = {
  admin: ['Runs everything: items, stock, confirming handwriting, trips, orders, people.', 'ಎಲ್ಲವನ್ನೂ ನಡೆಸುತ್ತಾರೆ: ಸಾಮಾನು, ಸ್ಟಾಕ್, ಕೈಬರಹ ಖಚಿತಪಡಿಸುವುದು, ಸಾಗಣೆ, ಆರ್ಡರ್, ಜನರು.'],
  owner: ['Sees how the shop is doing. Changes nothing.', 'ಅಂಗಡಿ ಹೇಗೆ ನಡೆಯುತ್ತಿದೆ ಎಂದು ನೋಡುತ್ತಾರೆ. ಏನೂ ಬದಲಿಸುವುದಿಲ್ಲ.'],
  worker: ['Sees each bill as a pick list by rack, ticks what was brought.', 'ಪ್ರತಿ ಬಿಲ್ ಅನ್ನು ರ‍್ಯಾಕ್ ಪ್ರಕಾರ ನೋಡಿ, ತಂದದ್ದನ್ನು ಗುರುತಿಸುತ್ತಾರೆ.'],
  godown: ['Sends what the shop asks for, receives what comes in.', 'ಅಂಗಡಿ ಕೇಳಿದ್ದನ್ನು ಕಳುಹಿಸುತ್ತಾರೆ, ಬಂದದ್ದನ್ನು ಸ್ವೀಕರಿಸುತ್ತಾರೆ.'],
  vendor: ['Confirms and dispatches the shop’s purchase orders.', 'ಅಂಗಡಿಯ ಖರೀದಿ ಆರ್ಡರ್‌ಗಳನ್ನು ಒಪ್ಪಿ ಕಳುಹಿಸುತ್ತಾರೆ.'],
  delivery: ['Today’s drops: call, map, collect, delivered.', 'ಇಂದಿನ ಡೆಲಿವರಿ: ಕರೆ, ನಕ್ಷೆ, ವಸೂಲಿ, ತಲುಪಿಸಿದೆ.'],
  customer: ['Their own bills and balance, shop items, and order requests.', 'ತಮ್ಮ ಬಿಲ್‌ಗಳು, ಬಾಕಿ, ಅಂಗಡಿ ಸಾಮಾನು ಮತ್ತು ಆರ್ಡರ್.'],
};

const STORY: { role: Role; to: string; en: string; kn: string }[] = [
  { role: 'admin', to: '/admin/bills', en: 'Bills arrive from the billing app. Typed lines are matched; handwritten lines are read.', kn: 'ಬಿಲ್ಲಿಂಗ್‌ನಿಂದ ಬಿಲ್‌ಗಳು ಬರುತ್ತವೆ. ಟೈಪ್ ಸಾಲುಗಳು ಹೊಂದುತ್ತವೆ, ಕೈಬರಹ ಓದಲಾಗುತ್ತದೆ.' },
  { role: 'admin', to: '/admin/confirm', en: 'Bill #54: the reader read “shahi biriyani masala”, but ₹1000 does not fit a ₹90 pack, so it asks you. Confirm it: stock drops and the name is learnt.', kn: 'ಬಿಲ್ #54: “ಶಾಹಿ ಬಿರಿಯಾನಿ ಮಸಾಲ” ಓದಿದೆ, ಆದರೆ ₹1000 ಬೆಲೆ ₹90 ಪ್ಯಾಕ್‌ಗೆ ಹೊಂದುತ್ತಿಲ್ಲ. ಖಚಿತಪಡಿಸಿ.' },
  { role: 'worker', to: '/worker', en: 'The shop worker sees bill #54 as a pick list grouped by rack, and ticks what was fetched.', kn: 'ಕೆಲಸಗಾರರು ಬಿಲ್ #54 ಅನ್ನು ರ‍್ಯಾಕ್ ಪ್ರಕಾರ ನೋಡಿ ತಂದದ್ದನ್ನು ಗುರುತಿಸುತ್ತಾರೆ.' },
  { role: 'admin', to: '/admin/refill', en: 'Running low: one trip from the main godown brings everything that is low. Ask the godown to send.', kn: 'ಮುಗಿಯುತ್ತಿದೆ: ಮುಖ್ಯ ಗೋದಾಮಿನಿಂದ ಒಂದೇ ಸಾಗಣೆ. ಗೋದಾಮಿಗೆ ಕಳುಹಿಸಲು ಹೇಳಿ.' },
  { role: 'godown', to: '/godown', en: 'The godown sees the request with its racks, fills in what it is actually sending, vehicle and driver, and taps Sent.', kn: 'ಗೋದಾಮು ಬೇಡಿಕೆ ನೋಡಿ, ಕಳುಹಿಸುವ ಪ್ರಮಾಣ, ವಾಹನ, ಚಾಲಕ ತುಂಬಿ “ಕಳುಹಿಸಿದೆ” ಒತ್ತುತ್ತದೆ.' },
  { role: 'admin', to: '/admin/transfers', en: 'At the shop, mark it received. A shortfall shows in red. Stock moves in every place.', kn: 'ಅಂಗಡಿಯಲ್ಲಿ “ಬಂದಿದೆ” ಎಂದು ಗುರುತಿಸಿ. ಕೊರತೆ ಕೆಂಪಿನಲ್ಲಿ.' },
  { role: 'vendor', to: '/vendor', en: 'The vendor confirms order #3 and dispatches it with invoice number, vehicle and time.', kn: 'ಸರಬರಾಜುದಾರರು ಆರ್ಡರ್ #3 ಒಪ್ಪಿ, ಇನ್‌ವಾಯ್ಸ್, ವಾಹನ, ಸಮಯದೊಂದಿಗೆ ಕಳುಹಿಸುತ್ತಾರೆ.' },
  { role: 'admin', to: '/admin/purchases', en: 'When the goods arrive, mark them received: the godown’s stock goes up.', kn: 'ಸಾಮಾನು ಬಂದಾಗ “ಬಂದಿದೆ” ಎಂದು ಗುರುತಿಸಿ: ಗೋದಾಮಿನ ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ.' },
  { role: 'delivery', to: '/delivery', en: 'Delivery: bill #54 to Ramesh, opposite the temple, collect the balance. Leaving now, then Delivered.', kn: 'ಡೆಲಿವರಿ: ಬಿಲ್ #54 ರಮೇಶ್‌ಗೆ, ದೇವಸ್ಥಾನದ ಎದುರು, ಬಾಕಿ ವಸೂಲಿ.' },
  { role: 'customer', to: '/customer', en: 'Ramesh sees his bills with the shop’s own handwriting, his balance, and orders again.', kn: 'ರಮೇಶ್ ತಮ್ಮ ಬಿಲ್‌ಗಳನ್ನು ಅಂಗಡಿಯ ಕೈಬರಹದೊಂದಿಗೆ, ಬಾಕಿ ನೋಡಿ ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡುತ್ತಾರೆ.' },
  { role: 'admin', to: '/admin/requests', en: 'The request reaches the admin, who bills it in the billing app and marks it billed.', kn: 'ಬೇಡಿಕೆ ಆಡ್ಮಿನ್‌ಗೆ ಬರುತ್ತದೆ; ಬಿಲ್ಲಿಂಗ್‌ನಲ್ಲಿ ಬಿಲ್ ಮಾಡಿ ಗುರುತಿಸುತ್ತಾರೆ.' },
  { role: 'owner', to: '/owner', en: 'The partner sees the day: sales, money due, stock value, what is low, and how much handwriting was read by itself.', kn: 'ಪಾಲುದಾರರು ದಿನವನ್ನು ನೋಡುತ್ತಾರೆ: ಮಾರಾಟ, ಬಾಕಿ, ಸ್ಟಾಕ್ ಮೌಲ್ಯ.' },
];

/**
 * The guided tour, only in demo mode. One button per role signs in as that role's demo person;
 * the story walks one day at the shop through every role in order.
 */
export function WalkthroughPage() {
  const bi = useBi();
  const { t, signInAs, me } = useSession();
  const nav = useNavigate();
  const [people, setPeople] = useState<{ role: Role; name: string; phone: string }[] | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api
      .demoPeople()
      .then(setPeople)
      .catch(() => setError(bi('The walkthrough only runs in demo mode (bash scripts/demo.sh).', 'ಇದು ಡೆಮೊ ಮೋಡ್‌ನಲ್ಲಿ ಮಾತ್ರ.')));
  }, []);

  const go = async (role: Role, to?: string) => {
    await signInAs(role);
    nav(to ?? ROLE_HOME[role]);
  };

  if (error) return <div className="page"><div className="msg err">{error}</div></div>;
  return (
    <div className="page">
      <h1 className="title">{bi('Shridhar Stock: walkthrough', 'ಶ್ರೀಧರ್ ಸ್ಟಾಕ್: ಪರಿಚಯ')}</h1>
      <p>
        {bi(
          'Everything here is demo data on this computer. Sign in as any role in one click, or follow the day at the shop below.',
          'ಇಲ್ಲಿ ಎಲ್ಲವೂ ಈ ಕಂಪ್ಯೂಟರ್‌ನ ಡೆಮೊ ಮಾಹಿತಿ. ಯಾವುದೇ ಪಾತ್ರವಾಗಿ ಒಂದೇ ಕ್ಲಿಕ್‌ನಲ್ಲಿ ಒಳಗೆ ಹೋಗಿ.',
        )}
        {me && <span className="muted"> · {bi('Now signed in as', 'ಈಗ')} {me.name}</span>}
      </p>
      {msg && <div className="msg ok">{msg}</div>}

      <h2 className="subtitle">{bi('Log in as', 'ಹೀಗೆ ಒಳಗೆ ಹೋಗಿ')}</h2>
      <div className="tiles roles">
        {(people ?? []).map((p) => (
          <button key={p.role} className="tile role-card" onClick={() => go(p.role)}>
            <b>{t(('role.' + p.role) as MsgKey)}</b>
            <span className="name">{p.name}</span>
            <span className="muted">
              {p.phone} · PIN 1111
            </span>
            <span>{bi(...ROLE_WHAT[p.role])}</span>
          </button>
        ))}
      </div>

      <h2 className="subtitle">{bi('A day at the shop', 'ಅಂಗಡಿಯ ಒಂದು ದಿನ')}</h2>
      <ol className="story">
        {STORY.map((s, i) => (
          <li key={i} className="card">
            <div className="bar between">
              <span className="pill">{t(('role.' + s.role) as MsgKey)}</span>
              <button className="btn small primary" onClick={() => go(s.role, s.to)}>
                {bi('Show me', 'ತೋರಿಸಿ')} →
              </button>
            </div>
            <p className="mt-8 mb-0">{bi(s.en, s.kn)}</p>
          </li>
        ))}
      </ol>
      <button
        className="btn"
        onClick={async () => {
          await api.resetDemo();
          setMsg(bi('Demo data is back to the start.', 'ಡೆಮೊ ಮಾಹಿತಿ ಮೊದಲಿನಂತಾಗಿದೆ.'));
        }}
      >
        ↺ {bi('Reset the demo', 'ಡೆಮೊ ಮೊದಲಿನಂತೆ ಮಾಡಿ')}
      </button>
    </div>
  );
}
