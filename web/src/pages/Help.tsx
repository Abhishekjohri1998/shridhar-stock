import { useNavigate } from 'react-router-dom';
import type { Role } from '@stock/core';
import { useSession } from '../lib/session';
import { useBi } from '../components/ui';
import { useTour } from '../components/Tour';
import { TOUR_HOME } from '../tours';
import { ExplainerPlayer } from '../explainer/Player';

type Pair = [en: string, kn: string];

/** One feature: what it is for, who uses it, and the tour that shows it. */
interface Section {
  tour: string;
  roles: Role[];
  title: Pair;
  body: Pair;
}

const SECTIONS: Section[] = [
  {
    tour: 'home',
    roles: ['admin'],
    title: ['Home', 'ಮುಖಪುಟ'],
    body: ['The day at a glance: what needs you now, what just went low, the week’s sales, and what is on the way.', 'ದಿನ ಒಂದೇ ನೋಟದಲ್ಲಿ: ಈಗ ನಿಮ್ಮ ಗಮನ ಬೇಕಾದ್ದು, ಈಗಷ್ಟೇ ಕಡಿಮೆಯಾದದ್ದು, ವಾರದ ಮಾರಾಟ, ದಾರಿಯಲ್ಲಿರುವುದು.'],
  },
  {
    tour: 'bills',
    roles: ['admin'],
    title: ['Bills', 'ಬಿಲ್‌ಗಳು'],
    body: ['Every bill from the billing app arrives here by itself. Typed lines match an item and take its stock down at once.', 'ಬಿಲ್ಲಿಂಗ್ ಆ್ಯಪ್‌ನ ಪ್ರತಿ ಬಿಲ್ ಇಲ್ಲಿಗೆ ತಾನಾಗಿ ಬರುತ್ತದೆ. ಟೈಪ್ ಸಾಲುಗಳು ಸಾಮಾನಿಗೆ ಹೊಂದಿ ತಕ್ಷಣ ಸ್ಟಾಕ್ ಕಡಿಮೆ ಮಾಡುತ್ತವೆ.'],
  },
  {
    tour: 'confirm',
    roles: ['admin'],
    title: ['To digitise', 'ಡಿಜಿಟೈಸ್ ಮಾಡಿ'],
    body: ['Handwritten lines, and names no item has, wait here. Pick the item and digitise: stock goes down and the name is remembered.', 'ಕೈಬರಹದ ಸಾಲುಗಳು ಮತ್ತು ಗೊತ್ತಿಲ್ಲದ ಹೆಸರುಗಳು ಇಲ್ಲಿ ಕಾಯುತ್ತವೆ. ಸಾಮಾನು ಆರಿಸಿ ಡಿಜಿಟೈಸ್ ಮಾಡಿ: ಸ್ಟಾಕ್ ಕಡಿಮೆಯಾಗುತ್ತದೆ, ಹೆಸರು ನೆನಪಿರುತ್ತದೆ.'],
  },
  {
    tour: 'inventory',
    roles: ['admin'],
    title: ['Inventory', 'ಸಾಮಾನು ಮತ್ತು ಸ್ಟಾಕ್'],
    body: ['Every item, its units and prices, and its stock in each place. Open an item to correct its count, in boxes or pieces. Its Stock tab sums it up: total, value at cost, last bought and sold, days left. Details holds its units (any name, a default unit), price by quantity, category and suppliers.', 'ಪ್ರತಿ ಸಾಮಾನು, ಘಟಕ ಮತ್ತು ಬೆಲೆ, ಪ್ರತಿ ಸ್ಥಳದ ಸ್ಟಾಕ್. ಎಣಿಕೆ ಸರಿಪಡಿಸಲು ಸಾಮಾನು ತೆರೆಯಿರಿ, ಬಾಕ್ಸ್ ಅಥವಾ ತುಂಡಿನಲ್ಲಿ. ಸ್ಟಾಕ್ ಟ್ಯಾಬ್: ಒಟ್ಟು, ಖರೀದಿ ಮೌಲ್ಯ, ಕೊನೆಯ ಖರೀದಿ ಮತ್ತು ಮಾರಾಟ, ಎಷ್ಟು ದಿನಕ್ಕೆ ಸಾಕು. ವಿವರ: ಘಟಕಗಳು (ಯಾವ ಹೆಸರೂ, ಮೊದಲ ಆಯ್ಕೆಯ ಘಟಕ), ಪ್ರಮಾಣದ ಪ್ರಕಾರ ಬೆಲೆ, ವರ್ಗ ಮತ್ತು ಸರಬರಾಜುದಾರರು.'],
  },
  {
    tour: 'refill',
    roles: ['admin'],
    title: ['Bring from godown', 'ಗೋದಾಮಿನಿಂದ ತರಿಸಿ'],
    body: ['What is low in the shop, grouped into one trip per godown. An item’s “Running out in Shop below” level decides it, else its level for all places. “Send request” puts it on the godown’s screen.', 'ಅಂಗಡಿಯಲ್ಲಿ ಕಡಿಮೆ ಇರುವುದು, ಪ್ರತಿ ಗೋದಾಮಿಗೆ ಒಂದು ಓಡಾಟ. ಸಾಮಾನಿನ “ಅಂಗಡಿಯಲ್ಲಿ ಇದಕ್ಕಿಂತ ಕಡಿಮೆ” ಮಟ್ಟ ಇದನ್ನು ನಿರ್ಧರಿಸುತ್ತದೆ, ಇಲ್ಲದಿದ್ದರೆ ಎಲ್ಲಾ ಕಡೆ ಸೇರಿದ ಮಟ್ಟ. “ಬೇಡಿಕೆ ಕಳುಹಿಸಿ” ಗೋದಾಮಿನ ಪರದೆಗೆ ಹೋಗುತ್ತದೆ.'],
  },
  {
    tour: 'purchases',
    roles: ['admin'],
    title: ['Purchases', 'ಖರೀದಿ'],
    body: ['What you ordered from suppliers. “Mark received” when the goods come: stock goes up in that place. “Order these” groups the buy list by each item’s usual supplier.', 'ಸರಬರಾಜುದಾರರಿಂದ ಆರ್ಡರ್ ಮಾಡಿದ್ದು. ಸಾಮಾನು ಬಂದಾಗ “ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ”: ಆ ಸ್ಥಳದ ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ. “ಇವನ್ನು ಆರ್ಡರ್ ಮಾಡಿ” ಖರೀದಿ ಪಟ್ಟಿಯನ್ನು ಯಾವಾಗಲೂ ಕೊಡುವವರ ಪ್ರಕಾರ ಗುಂಪು ಮಾಡುತ್ತದೆ.'],
  },
  {
    tour: 'transfers',
    roles: ['admin'],
    title: ['Transfers', 'ಸಾಗಣೆ'],
    body: ['Goods between the shop and godowns, with vehicle and driver. Asked, then sent by the godown, then received at the shop.', 'ಅಂಗಡಿ ಮತ್ತು ಗೋದಾಮುಗಳ ನಡುವೆ ಸಾಮಾನು, ವಾಹನ ಮತ್ತು ಚಾಲಕ ಜೊತೆ. ಕೇಳಿದ್ದು, ಗೋದಾಮು ಕಳುಹಿಸಿದ್ದು, ಅಂಗಡಿಗೆ ಬಂದದ್ದು.'],
  },
  {
    tour: 'setup',
    roles: ['admin'],
    title: ['Setup', 'ಸೆಟಪ್'],
    body: ['Places, people and their PINs, vehicles, Excel files, the billing link and rounding off.', 'ಸ್ಥಳಗಳು, ಜನರು ಮತ್ತು ಪಿನ್, ವಾಹನಗಳು, ಎಕ್ಸೆಲ್ ಫೈಲ್, ಬಿಲ್ಲಿಂಗ್ ಸಂಪರ್ಕ, ರೌಂಡ್ ಆಫ್.'],
  },
  {
    tour: 'reports',
    roles: ['admin'],
    title: ['Reports', 'ವರದಿಗಳು'],
    body: ['Sales by item, stock value, fast and slow sellers, and trips by vehicle, each downloadable for Excel.', 'ಸಾಮಾನು ಪ್ರಕಾರ ಮಾರಾಟ, ಸ್ಟಾಕ್ ಮೌಲ್ಯ, ವೇಗ ಮತ್ತು ನಿಧಾನ, ವಾಹನದ ಓಡಾಟ, ಎಲ್ಲವೂ ಎಕ್ಸೆಲ್‌ಗೆ.'],
  },
  {
    tour: 'worker',
    roles: ['admin', 'worker'],
    title: ['Pick list (worker)', 'ಪಟ್ಟಿ (ಕೆಲಸಗಾರ)'],
    body: ['Each bill grouped by rack. Tick “Fetched” as you pick: billing’s tick turns on too.', 'ಪ್ರತಿ ಬಿಲ್ ರ‍್ಯಾಕ್ ಪ್ರಕಾರ. ತರುವಾಗ “ತಂದೆ” ಟಿಕ್ ಮಾಡಿ: ಬಿಲ್ಲಿಂಗ್‌ನ ಟಿಕ್ ಕೂಡ ಬರುತ್ತದೆ.'],
  },
  {
    tour: 'tv',
    roles: ['admin', 'worker'],
    title: ['TV screen', 'ಟಿವಿ ಪರದೆ'],
    body: ['The newest bill, large, for the second monitor at the counter. It only shows; nothing to press.', 'ಹೊಸ ಬಿಲ್, ದೊಡ್ಡದಾಗಿ, ಕೌಂಟರ್‌ನ ಎರಡನೇ ಮಾನಿಟರ್‌ಗೆ. ತೋರಿಸುತ್ತದೆ ಮಾತ್ರ.'],
  },
  {
    tour: 'godown',
    roles: ['admin', 'worker'],
    title: ['Godown', 'ಗೋದಾಮು'],
    body: ['A tab of the worker screen, for any worker. The shop’s requests with their racks. “Send to shop” when the vehicle leaves; “Mark received” for goods coming in.', 'ಅಂಗಡಿಯ ಬೇಡಿಕೆ, ರ‍್ಯಾಕ್ ಜೊತೆ. ವಾಹನ ಹೊರಟಾಗ “ಅಂಗಡಿಗೆ ಕಳುಹಿಸಿ”; ಬಂದ ಸಾಮಾನಿಗೆ “ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ”.'],
  },
];

/** The picture: how a bill moves stock, and how stock comes back. */
const FLOW: { label: Pair; tone?: 'up' | 'down' }[] = [
  { label: ['Bill in billing', 'ಬಿಲ್ಲಿಂಗ್‌ನಲ್ಲಿ ಬಿಲ್'] },
  { label: ['Stock goes down', 'ಸ್ಟಾಕ್ ಕಡಿಮೆ'], tone: 'down' },
  { label: ['Running low', 'ಮುಗಿಯುತ್ತಿದೆ'], tone: 'down' },
  { label: ['Bring from godown, or buy', 'ಗೋದಾಮಿನಿಂದ ತರಿಸಿ, ಅಥವಾ ಕೊಳ್ಳಿ'] },
  { label: ['Stock goes up', 'ಸ್ಟಾಕ್ ಹೆಚ್ಚು'], tone: 'up' },
];

/** How it all works: the flow in one picture, then a short section per feature with "Show me". */
export function HelpPage() {
  const bi = useBi();
  const { me } = useSession();
  const { start } = useTour();
  const nav = useNavigate();
  // An old godown login is a worker now.
  const role = me?.role === 'godown' ? 'worker' : (me?.role ?? 'admin');
  const mine = SECTIONS.filter((s) => s.roles.includes(role));
  const show = (id: string) => {
    nav(TOUR_HOME[id] ?? '/');
    // The screen renders first; the tour then finds its parts.
    setTimeout(() => start(id), 300);
  };
  return (
    <>
      <h1 className="title">{bi('How it all works', 'ಇದೆಲ್ಲ ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ')}</h1>
      {role === 'admin' && (
        <div className="card">
          <ExplainerPlayer />
        </div>
      )}
      <div className="card">
        <ol className="flow" aria-label={bi('How stock moves', 'ಸ್ಟಾಕ್ ಹೇಗೆ ಬದಲಾಗುತ್ತದೆ')}>
          {FLOW.map((f, i) => (
            <li key={i}>
              <span className={'flow-step' + (f.tone ? ' ' + f.tone : '')}>{bi(...f.label)}</span>
              {i < FLOW.length - 1 && (
                <span className="flow-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="m-0">
          {bi(
            'A bill made at the counter takes stock down in the shop by itself. Handwritten lines wait in To digitise until you pick the item. When an item runs low, bring it from a godown in one trip, or buy it from a supplier. When it arrives and is marked received, stock goes up again. Every change is kept, so every number can be explained.',
            'ಕೌಂಟರ್‌ನಲ್ಲಿ ಮಾಡಿದ ಬಿಲ್ ಅಂಗಡಿಯ ಸ್ಟಾಕ್ ತಾನಾಗಿ ಕಡಿಮೆ ಮಾಡುತ್ತದೆ. ಕೈಬರಹದ ಸಾಲುಗಳು ನೀವು ಸಾಮಾನು ಆರಿಸುವವರೆಗೆ ಡಿಜಿಟೈಸ್ ಮಾಡಿ ಯಲ್ಲಿ ಕಾಯುತ್ತವೆ. ಸಾಮಾನು ಮುಗಿಯುತ್ತಿದ್ದಾಗ ಗೋದಾಮಿನಿಂದ ಒಂದೇ ಓಡಾಟದಲ್ಲಿ ತರಿಸಿ, ಅಥವಾ ಸರಬರಾಜುದಾರರಿಂದ ಕೊಳ್ಳಿ. ಬಂದು “ಬಂದಿದೆ” ಎಂದು ಗುರುತಿಸಿದಾಗ ಸ್ಟಾಕ್ ಮತ್ತೆ ಹೆಚ್ಚುತ್ತದೆ. ಪ್ರತಿ ಬದಲಾವಣೆ ಉಳಿಯುತ್ತದೆ.',
          )}
        </p>
      </div>
      <p className="muted">
        {bi('Every screen has a “?” button at the top that plays its tour again.', 'ಪ್ರತಿ ಪುಟದ ಮೇಲೆ “?” ಗುಂಡಿ ಇದೆ, ಅದು ಆ ಪುಟದ ಪರಿಚಯ ಮತ್ತೆ ತೋರಿಸುತ್ತದೆ.')}
      </p>
      {mine.map((s) => (
        <section className="card help-section" key={s.tour} id={'help-' + s.tour}>
          <div className="bar between">
            <h2 className="subtitle m-0">{bi(...s.title)}</h2>
            <button className="btn small primary" onClick={() => show(s.tour)}>
              {bi('Show me', 'ತೋರಿಸಿ')} →
            </button>
          </div>
          <p className="m-0">{bi(...s.body)}</p>
        </section>
      ))}
    </>
  );
}
