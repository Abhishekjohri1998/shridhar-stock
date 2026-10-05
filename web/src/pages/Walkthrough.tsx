import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_HOME, type MsgKey, type Role } from '@stock/core';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useBi } from '../components/ui';

const ROLE_WHAT: Partial<Record<Role, [string, string]>> = {
  admin: ['Runs everything: bills, confirming written lines, inventory, bringing from the godown, purchases, setup.', 'ಎಲ್ಲವನ್ನೂ ನಡೆಸುತ್ತಾರೆ: ಬಿಲ್, ಬರೆದ ಸಾಲು ಖಚಿತಪಡಿಸುವುದು, ಸಾಮಾನು, ಗೋದಾಮಿನಿಂದ ತರಿಸುವುದು, ಖರೀದಿ, ಸೆಟಪ್.'],
  worker: ['Sees each bill as a pick list by rack, ticks what was fetched. The TV screen shows it big.', 'ಪ್ರತಿ ಬಿಲ್ ಅನ್ನು ರ‍್ಯಾಕ್ ಪ್ರಕಾರ ನೋಡಿ, ತಂದದ್ದನ್ನು ಟಿಕ್ ಮಾಡುತ್ತಾರೆ. ಟಿವಿ ಪರದೆ ದೊಡ್ಡದಾಗಿ ತೋರಿಸುತ್ತದೆ.'],
  godown: ['Sends what the shop asks for, receives what comes in.', 'ಅಂಗಡಿ ಕೇಳಿದ್ದನ್ನು ಕಳುಹಿಸುತ್ತಾರೆ, ಬಂದದ್ದನ್ನು ಸ್ವೀಕರಿಸುತ್ತಾರೆ.'],
};

const STORY: { role: Role; to: string; en: string; kn: string }[] = [
  { role: 'admin', to: '/admin', en: 'Home: what needs you now, today’s sales and the week. The first time each person signs in, a short tour explains the screen; “?” plays it again.', kn: 'ಮುಖಪುಟ: ಈಗ ನಿಮ್ಮ ಗಮನ ಬೇಕಾದ್ದು, ಇಂದಿನ ಮಾರಾಟ, ವಾರ. ಮೊದಲ ಸಲ ಒಳಗೆ ಬಂದಾಗ ಚಿಕ್ಕ ಪರಿಚಯ; “?” ಮತ್ತೆ ತೋರಿಸುತ್ತದೆ.' },
  { role: 'admin', to: '/admin/bills', en: 'Bills arrive from the billing app by themselves. Typed lines are matched to items and take stock down.', kn: 'ಬಿಲ್ಲಿಂಗ್‌ನಿಂದ ಬಿಲ್‌ಗಳು ತಾನಾಗಿ ಬರುತ್ತವೆ. ಟೈಪ್ ಸಾಲುಗಳು ಸಾಮಾನಿಗೆ ಹೊಂದಿ ಸ್ಟಾಕ್ ಕಡಿಮೆ ಮಾಡುತ್ತವೆ.' },
  { role: 'admin', to: '/admin/confirm', en: 'Bills · To confirm: bills #53 and #54 have handwritten lines. Pick the item for each, then “Confirm all on this bill”: the lines leave the list and stock goes down.', kn: 'ಬಿಲ್ · ಖಚಿತಪಡಿಸಿ: ಬಿಲ್ #53, #54 ರಲ್ಲಿ ಕೈಬರಹದ ಸಾಲುಗಳಿವೆ. ಪ್ರತಿಯೊಂದಕ್ಕೆ ಸಾಮಾನು ಆರಿಸಿ, “ಈ ಬಿಲ್‌ನ ಎಲ್ಲಾ ಖಚಿತಪಡಿಸಿ”: ಸ್ಟಾಕ್ ಕಡಿಮೆಯಾಗುತ್ತದೆ.' },
  { role: 'worker', to: '/worker', en: 'The shop worker sees bill #54 as a pick list grouped by rack, and ticks what was fetched: billing’s tick turns on too.', kn: 'ಕೆಲಸಗಾರರು ಬಿಲ್ #54 ಅನ್ನು ರ‍್ಯಾಕ್ ಪ್ರಕಾರ ನೋಡಿ ತಂದದ್ದನ್ನು ಟಿಕ್ ಮಾಡುತ್ತಾರೆ: ಬಿಲ್ಲಿಂಗ್‌ನ ಟಿಕ್ ಕೂಡ ಬರುತ್ತದೆ.' },
  { role: 'worker', to: '/worker/screen', en: 'The TV screen: the same bill, big, for the second monitor at the counter.', kn: 'ಟಿವಿ ಪರದೆ: ಅದೇ ಬಿಲ್, ದೊಡ್ಡದಾಗಿ, ಕೌಂಟರ್‌ನ ಎರಡನೇ ಮಾನಿಟರ್‌ಗೆ.' },
  { role: 'admin', to: '/admin/inventory?low=1', en: 'Inventory: coffee and toor dal are low with the shop and godowns added up. An item’s page corrects its count in boxes.', kn: 'ಸಾಮಾನು: ಅಂಗಡಿ ಮತ್ತು ಗೋದಾಮು ಸೇರಿಸಿ ಕಾಫಿ, ತೊಗರಿ ಬೇಳೆ ಕಡಿಮೆ. ಸಾಮಾನಿನ ಪುಟದಲ್ಲಿ ಬಾಕ್ಸ್‌ನಲ್ಲಿ ಎಣಿಕೆ ಸರಿಪಡಿಸಬಹುದು.' },
  { role: 'admin', to: '/admin/refill', en: 'Inventory · Bring from godown: one trip from the main godown brings everything that is low. Tap “Send request”.', kn: 'ಸಾಮಾನು · ಗೋದಾಮಿನಿಂದ ತರಿಸಿ: ಮುಖ್ಯ ಗೋದಾಮಿನಿಂದ ಒಂದೇ ಓಡಾಟ. “ಬೇಡಿಕೆ ಕಳುಹಿಸಿ” ಒತ್ತಿ.' },
  { role: 'godown', to: '/godown', en: 'The godown sees the request with its racks, fills in what it is actually sending, vehicle and driver, and taps “Send to shop”.', kn: 'ಗೋದಾಮು ಬೇಡಿಕೆ ನೋಡಿ, ಕಳುಹಿಸುವ ಪ್ರಮಾಣ, ವಾಹನ, ಚಾಲಕ ತುಂಬಿ “ಅಂಗಡಿಗೆ ಕಳುಹಿಸಿ” ಒತ್ತುತ್ತದೆ.' },
  { role: 'admin', to: '/admin/transfers', en: 'Buy & move · Transfers: at the shop, “Mark received”. A shortfall shows in red; stock goes up in the shop.', kn: 'ಖರೀದಿ ಮತ್ತು ಸಾಗಣೆ · ಸಾಗಣೆ: ಅಂಗಡಿಯಲ್ಲಿ “ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ”. ಕೊರತೆ ಕೆಂಪಿನಲ್ಲಿ; ಅಂಗಡಿಯ ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ.' },
  { role: 'admin', to: '/admin/purchases', en: 'Buy & move · Purchases: order from a supplier in one short form. When the goods arrive, “Mark received”: stock goes up where they were put.', kn: 'ಖರೀದಿ: ಒಂದೇ ಚಿಕ್ಕ ಫಾರ್ಮ್‌ನಲ್ಲಿ ಆರ್ಡರ್. ಸಾಮಾನು ಬಂದಾಗ “ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ”: ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ.' },
  { role: 'admin', to: '/admin/places', en: 'Setup: places, people (Admin, Shop worker, Godown), vehicles, Excel and settings.', kn: 'ಸೆಟಪ್: ಸ್ಥಳಗಳು, ಜನರು (ಆಡ್ಮಿನ್, ಅಂಗಡಿ ಕೆಲಸಗಾರ, ಗೋದಾಮು), ವಾಹನಗಳು, ಎಕ್ಸೆಲ್, ಸೆಟ್ಟಿಂಗ್ಸ್.' },
  { role: 'admin', to: '/help', en: 'How it all works: one picture of the flow, and “Show me” for every screen’s tour.', kn: 'ಇದೆಲ್ಲ ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ: ಒಂದು ಚಿತ್ರ, ಮತ್ತು ಪ್ರತಿ ಪುಟದ ಪರಿಚಯಕ್ಕೆ “ತೋರಿಸಿ”.' },
];

/**
 * The guided tour, only in demo mode. One button per role signs in as that role's demo person;
 * the story walks one day at the shop through the three roles in order.
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
            {ROLE_WHAT[p.role] && <span>{bi(...ROLE_WHAT[p.role]!)}</span>}
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
