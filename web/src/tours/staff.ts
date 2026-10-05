import { step, tour } from './types';

const helpStep = step(
  'help-button',
  ['The “?” button', '“?” ಗುಂಡಿ'],
  ['It is at the top of your screen.', 'ಇದು ನಿಮ್ಮ ಪರದೆಯ ಮೇಲ್ಭಾಗದಲ್ಲಿದೆ.'],
  ['It plays this tour again whenever you need it.', 'ಬೇಕಾದಾಗ ಈ ಪರಿಚಯವನ್ನು ಮತ್ತೆ ತೋರಿಸುತ್ತದೆ.'],
  ['The tour starts again. Nothing changes.', 'ಪರಿಚಯ ಮತ್ತೆ ಶುರುವಾಗುತ್ತದೆ. ಏನೂ ಬದಲಾಗುವುದಿಲ್ಲ.'],
);

export const workerTour = tour('worker', ['Pick list', 'ಪಟ್ಟಿ'], [
  step(
    undefined,
    ['Your pick list', 'ನಿಮ್ಮ ಪಟ್ಟಿ'],
    ['Each bill from the counter, as soon as it is made.', 'ಕೌಂಟರ್‌ನ ಪ್ರತಿ ಬಿಲ್, ಮಾಡಿದ ತಕ್ಷಣ.'],
    ['Its lines are grouped by rack, so you walk the shop once.', 'ಸಾಲುಗಳು ರ‍್ಯಾಕ್ ಪ್ರಕಾರ ಗುಂಪು, ಅಂಗಡಿಯಲ್ಲಿ ಒಮ್ಮೆ ಸುತ್ತಿದರೆ ಸಾಕು.'],
    ['Tap Next to see each part.', 'ಪ್ರತಿ ಭಾಗ ನೋಡಲು ಮುಂದೆ ಒತ್ತಿ.'],
  ),
  step(
    'section-tabs',
    ['Pick list · TV screen', 'ಪಟ್ಟಿ · ಟಿವಿ ಪರದೆ'],
    ['Two views of the same bills.', 'ಅದೇ ಬಿಲ್‌ಗಳ ಎರಡು ನೋಟ.'],
    ['The TV screen is large, for the second monitor at the counter.', 'ಟಿವಿ ಪರದೆ ದೊಡ್ಡದು, ಕೌಂಟರ್‌ನ ಎರಡನೇ ಮಾನಿಟರ್‌ಗೆ.'],
    ['That view opens.', 'ಆ ನೋಟ ತೆರೆಯುತ್ತದೆ.'],
  ),
  step(
    'worker-bills',
    ['Today’s bills', 'ಇಂದಿನ ಬಿಲ್‌ಗಳು'],
    ['One button per bill: number, customer, how many fetched.', 'ಪ್ರತಿ ಬಿಲ್‌ಗೆ ಒಂದು ಗುಂಡಿ: ಸಂಖ್ಯೆ, ಗ್ರಾಹಕ, ಎಷ್ಟು ತಂದಿದೆ.'],
    ['“Being written” is a bill still open at the counter: you can start early.', '“ಬರೆಯಲಾಗುತ್ತಿದೆ” ಎಂದರೆ ಕೌಂಟರ್‌ನಲ್ಲಿ ಇನ್ನೂ ತೆರೆದ ಬಿಲ್: ಮೊದಲೇ ಶುರು ಮಾಡಬಹುದು.'],
    ['That bill opens below.', 'ಆ ಬಿಲ್ ಕೆಳಗೆ ತೆರೆಯುತ್ತದೆ.'],
  ),
  step(
    'worker-bill',
    ['The bill', 'ಬಿಲ್'],
    ['Bill number and customer.', 'ಬಿಲ್ ಸಂಖ್ಯೆ ಮತ್ತು ಗ್ರಾಹಕ.'],
    ['New bills come in by themselves; you never refresh.', 'ಹೊಸ ಬಿಲ್‌ಗಳು ತಾನಾಗಿ ಬರುತ್ತವೆ; ರಿಫ್ರೆಶ್ ಬೇಡ.'],
    ['Nothing: it is the heading.', 'ಏನೂ ಇಲ್ಲ: ಇದು ತಲೆಬರಹ.'],
  ),
  step(
    'worker-count',
    ['Fetched so far', 'ಇದುವರೆಗೆ ತಂದದ್ದು'],
    ['How many lines you have fetched out of all.', 'ಎಲ್ಲಾ ಸಾಲುಗಳಲ್ಲಿ ಎಷ್ಟು ತಂದಿದ್ದೀರಿ.'],
    ['Green when the whole bill is ready.', 'ಇಡೀ ಬಿಲ್ ಸಿದ್ಧವಾದಾಗ ಹಸಿರು.'],
    ['Nothing: it counts by itself.', 'ಏನೂ ಇಲ್ಲ: ತಾನೇ ಎಣಿಸುತ್ತದೆ.'],
  ),
  step(
    'worker-total',
    ['Total', 'ಒಟ್ಟು'],
    ['The bill’s total, rounded as the counter collects it.', 'ಬಿಲ್ ಮೊತ್ತ, ಕೌಂಟರ್ ತೆಗೆದುಕೊಳ್ಳುವಂತೆ ರೌಂಡ್.'],
    ['For when a customer asks how much.', 'ಗ್ರಾಹಕ ಎಷ್ಟು ಎಂದು ಕೇಳಿದಾಗ.'],
    ['Nothing.', 'ಏನೂ ಇಲ್ಲ.'],
  ),
  step(
    'worker-rack',
    ['One rack', 'ಒಂದು ರ‍್ಯಾಕ್'],
    ['📍 the rack, then everything on this bill kept there.', '📍 ರ‍್ಯಾಕ್, ನಂತರ ಈ ಬಿಲ್‌ನಲ್ಲಿ ಅಲ್ಲಿರುವ ಎಲ್ಲ.'],
    ['Handwritten lines show the writing itself.', 'ಕೈಬರಹದ ಸಾಲುಗಳಲ್ಲಿ ಬರಹವೇ ಕಾಣುತ್ತದೆ.'],
    ['Nothing on the card; tick each line instead.', 'ಕಾರ್ಡ್ ಒತ್ತಿದರೆ ಏನೂ ಇಲ್ಲ; ಪ್ರತಿ ಸಾಲು ಟಿಕ್ ಮಾಡಿ.'],
  ),
  step(
    'worker-fetch',
    ['Fetched', 'ತಂದೆ'],
    ['Tick a line when you have it in hand.', 'ಸಾಮಾನು ಕೈಯಲ್ಲಿ ಬಂದಾಗ ಸಾಲು ಟಿಕ್ ಮಾಡಿ.'],
    ['The tick goes to billing too, so the counter sees it is given.', 'ಟಿಕ್ ಬಿಲ್ಲಿಂಗ್‌ಗೂ ಹೋಗುತ್ತದೆ, ಕೌಂಟರ್‌ಗೆ ಕೊಟ್ಟಿದೆ ಎಂದು ಕಾಣುತ್ತದೆ.'],
    ['It turns ✓ here, and billing’s tick turns on. Tap again to undo.', 'ಇಲ್ಲಿ ✓ ಆಗುತ್ತದೆ, ಬಿಲ್ಲಿಂಗ್‌ನ ಟಿಕ್ ಬರುತ್ತದೆ. ಮತ್ತೆ ಒತ್ತಿದರೆ ತೆಗೆಯುತ್ತದೆ.'],
  ),
  step(
    'worker-select-all',
    ['Select all · Select none', 'ಎಲ್ಲ ಆಯ್ಕೆ · ಯಾವುದೂ ಬೇಡ'],
    ['Ticks or unticks every line on the bill at once.', 'ಬಿಲ್‌ನ ಎಲ್ಲಾ ಸಾಲುಗಳನ್ನು ಒಮ್ಮೆಲೇ ಟಿಕ್ ಅಥವಾ ತೆಗೆಯುತ್ತದೆ.'],
    ['For a bill you packed in one go.', 'ಒಂದೇ ಸಲ ಕಟ್ಟಿದ ಬಿಲ್‌ಗೆ.'],
    ['All lines change, and billing gets every tick.', 'ಎಲ್ಲಾ ಸಾಲು ಬದಲಾಗುತ್ತವೆ, ಬಿಲ್ಲಿಂಗ್‌ಗೆ ಎಲ್ಲಾ ಟಿಕ್ ಹೋಗುತ್ತವೆ.'],
  ),
  helpStep,
]);

export const tvTour = tour('tv', ['TV screen', 'ಟಿವಿ ಪರದೆ'], [
  step(
    undefined,
    ['The TV screen', 'ಟಿವಿ ಪರದೆ'],
    ['A large pick list for the second monitor.', 'ಎರಡನೇ ಮಾನಿಟರ್‌ಗೆ ದೊಡ್ಡ ಪಟ್ಟಿ.'],
    ['It always shows the newest bill, big enough to read from the racks.', 'ಯಾವಾಗಲೂ ಹೊಸ ಬಿಲ್, ರ‍್ಯಾಕ್ ಬಳಿಯಿಂದ ಓದುವಷ್ಟು ದೊಡ್ಡದು.'],
    ['Leave it open; it updates by itself.', 'ತೆರೆದಿಡಿ; ತಾನಾಗಿ ಬದಲಾಗುತ್ತದೆ.'],
  ),
  step(
    'section-tabs',
    ['Back to the pick list', 'ಪಟ್ಟಿಗೆ ಹಿಂತಿರುಗಿ'],
    ['Pick list is where you tick lines.', 'ಪಟ್ಟಿಯಲ್ಲಿ ಸಾಲು ಟಿಕ್ ಮಾಡುತ್ತೀರಿ.'],
    ['The TV only shows; it has no buttons to press by mistake.', 'ಟಿವಿ ತೋರಿಸುತ್ತದೆ ಮಾತ್ರ; ತಪ್ಪಿ ಒತ್ತುವ ಗುಂಡಿಗಳಿಲ್ಲ.'],
    ['The pick list opens.', 'ಪಟ್ಟಿ ತೆರೆಯುತ್ತದೆ.'],
  ),
  step(
    'worker-bill',
    ['The newest bill', 'ಹೊಸ ಬಿಲ್'],
    ['Bill number and customer, in large letters.', 'ಬಿಲ್ ಸಂಖ್ಯೆ ಮತ್ತು ಗ್ರಾಹಕ, ದೊಡ್ಡ ಅಕ್ಷರದಲ್ಲಿ.'],
    ['A new bill replaces it as soon as it is made.', 'ಹೊಸ ಬಿಲ್ ಆದ ತಕ್ಷಣ ಬದಲಾಗುತ್ತದೆ.'],
    ['Nothing.', 'ಏನೂ ಇಲ್ಲ.'],
  ),
  step(
    'worker-count',
    ['Fetched so far', 'ಇದುವರೆಗೆ ತಂದದ್ದು'],
    ['How many lines are ticked on the pick list.', 'ಪಟ್ಟಿಯಲ್ಲಿ ಎಷ್ಟು ಸಾಲು ಟಿಕ್ ಆಗಿವೆ.'],
    ['Follows the workers’ ticks as they happen.', 'ಕೆಲಸಗಾರರ ಟಿಕ್ ಆದಂತೆ ಬದಲಾಗುತ್ತದೆ.'],
    ['Nothing.', 'ಏನೂ ಇಲ್ಲ.'],
  ),
  step(
    'worker-total',
    ['Total', 'ಒಟ್ಟು'],
    ['The bill total, rounded.', 'ಬಿಲ್ ಮೊತ್ತ, ರೌಂಡ್.'],
    ['Customers can read it from the counter.', 'ಗ್ರಾಹಕರು ಕೌಂಟರ್‌ನಿಂದ ಓದಬಹುದು.'],
    ['Nothing.', 'ಏನೂ ಇಲ್ಲ.'],
  ),
  step(
    'worker-rack',
    ['By rack', 'ರ‍್ಯಾಕ್ ಪ್ರಕಾರ'],
    ['The lines, grouped by where they are kept.', 'ಸಾಲುಗಳು, ಇಟ್ಟಿರುವ ಜಾಗದ ಪ್ರಕಾರ ಗುಂಪು.'],
    ['A ✓ appears as each line is fetched.', 'ತಂದಂತೆ ಪ್ರತಿ ಸಾಲಿಗೆ ✓ ಬರುತ್ತದೆ.'],
    ['Nothing.', 'ಏನೂ ಇಲ್ಲ.'],
  ),
  helpStep,
]);

export const godownTour = tour('godown', ['My godown', 'ನನ್ನ ಗೋದಾಮು'], [
  step(
    undefined,
    ['Your godown', 'ನಿಮ್ಮ ಗೋದಾಮು'],
    ['What the shop asks you to send, and what is coming to you.', 'ಅಂಗಡಿ ಕಳುಹಿಸಲು ಕೇಳಿದ್ದು, ಮತ್ತು ನಿಮಗೆ ಬರುತ್ತಿರುವುದು.'],
    ['Requests appear here by themselves, the moment the shop sends them.', 'ಅಂಗಡಿ ಕಳುಹಿಸಿದ ಕ್ಷಣ ಬೇಡಿಕೆಗಳು ಇಲ್ಲಿ ತಾನಾಗಿ ಬರುತ್ತವೆ.'],
    ['Tap Next to see each part.', 'ಪ್ರತಿ ಭಾಗ ನೋಡಲು ಮುಂದೆ ಒತ್ತಿ.'],
  ),
  step(
    'godown-tabs',
    ['To send · Coming in · My stock', 'ಕಳುಹಿಸಬೇಕು · ಬರುತ್ತಿದೆ · ನನ್ನ ಸ್ಟಾಕ್'],
    ['Three tabs. The number is how many are waiting.', 'ಮೂರು ಟ್ಯಾಬ್. ಸಂಖ್ಯೆ ಎಷ್ಟು ಬಾಕಿ ಎಂದು.'],
    ['To send is the shop’s requests; Coming in is goods sent to you.', 'ಕಳುಹಿಸಬೇಕು ಅಂಗಡಿಯ ಬೇಡಿಕೆ; ಬರುತ್ತಿದೆ ನಿಮಗೆ ಕಳುಹಿಸಿದ ಸಾಮಾನು.'],
    ['That tab opens.', 'ಆ ಟ್ಯಾಬ್ ತೆರೆಯುತ್ತದೆ.'],
  ),
  step(
    'godown-send-card',
    ['A request from the shop', 'ಅಂಗಡಿಯ ಬೇಡಿಕೆ'],
    ['Each item asked, with its rack here.', 'ಕೇಳಿದ ಪ್ರತಿ ಸಾಮಾನು, ಇಲ್ಲಿನ ರ‍್ಯಾಕ್ ಜೊತೆ.'],
    ['Walk the racks in order and load the vehicle.', 'ರ‍್ಯಾಕ್ ಕ್ರಮವಾಗಿ ಸುತ್ತಿ ವಾಹನಕ್ಕೆ ತುಂಬಿಸಿ.'],
    ['Nothing on the card; use its boxes and button.', 'ಕಾರ್ಡ್ ಒತ್ತಿದರೆ ಏನೂ ಇಲ್ಲ; ಡಬ್ಬಿ ಮತ್ತು ಗುಂಡಿ ಬಳಸಿ.'],
  ),
  step(
    'godown-sending',
    ['Sending', 'ಕಳುಹಿಸುವುದು'],
    ['How much you are really sending.', 'ನಿಜವಾಗಿ ಎಷ್ಟು ಕಳುಹಿಸುತ್ತಿದ್ದೀರಿ.'],
    ['It starts at what was asked, or what you have if less.', 'ಕೇಳಿದಷ್ಟು, ಅಥವಾ ಕಡಿಮೆ ಇದ್ದರೆ ಇರುವಷ್ಟು, ಮೊದಲೇ ತುಂಬಿರುತ್ತದೆ.'],
    ['The keyboard opens. Nothing is sent yet.', 'ಕೀಬೋರ್ಡ್ ತೆರೆಯುತ್ತದೆ. ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ.'],
  ),
  step(
    'godown-vehicle',
    ['Vehicle and driver', 'ವಾಹನ ಮತ್ತು ಚಾಲಕ'],
    ['Which vehicle takes it, and who drives.', 'ಯಾವ ವಾಹನ, ಯಾರು ಓಡಿಸುತ್ತಾರೆ.'],
    ['The shop’s vehicles are offered as you type.', 'ಟೈಪ್ ಮಾಡಿದಂತೆ ಅಂಗಡಿಯ ವಾಹನಗಳು ಕಾಣುತ್ತವೆ.'],
    ['A list of vehicles opens; any other name can be typed.', 'ವಾಹನಗಳ ಪಟ್ಟಿ ತೆರೆಯುತ್ತದೆ; ಬೇರೆ ಹೆಸರೂ ಟೈಪ್ ಮಾಡಬಹುದು.'],
  ),
  step(
    'godown-send',
    ['Send to shop', 'ಅಂಗಡಿಗೆ ಕಳುಹಿಸಿ'],
    ['Press it when the vehicle leaves.', 'ವಾಹನ ಹೊರಟಾಗ ಒತ್ತಿ.'],
    ['Your godown’s stock goes down by what you sent.', 'ನೀವು ಕಳುಹಿಸಿದಷ್ಟು ಗೋದಾಮಿನ ಸ್ಟಾಕ್ ಕಡಿಮೆಯಾಗುತ್ತದೆ.'],
    ['One line says what left; the shop sees it on the way.', 'ಏನು ಹೊರಟಿತು ಎಂದು ಒಂದು ಸಾಲು; ಅಂಗಡಿಗೆ ದಾರಿಯಲ್ಲಿದೆ ಎಂದು ಕಾಣುತ್ತದೆ.'],
  ),
  step(
    'godown-receive',
    ['Mark received', 'ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ'],
    ['In Coming in, for goods sent to your godown.', 'ಬರುತ್ತಿದೆ ಟ್ಯಾಬ್‌ನಲ್ಲಿ, ನಿಮ್ಮ ಗೋದಾಮಿಗೆ ಕಳುಹಿಸಿದ ಸಾಮಾನಿಗೆ.'],
    ['Type what actually arrived if it is short.', 'ಕಡಿಮೆ ಬಂದಿದ್ದರೆ ನಿಜವಾಗಿ ಬಂದದ್ದನ್ನು ಟೈಪ್ ಮಾಡಿ.'],
    ['Your stock rises by that much, and one line says so.', 'ಅಷ್ಟು ನಿಮ್ಮ ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ, ಒಂದು ಸಾಲು ಹೇಳುತ್ತದೆ.'],
  ),
  step(
    'godown-stock',
    ['My stock', 'ನನ್ನ ಸ್ಟಾಕ್'],
    ['Everything in your godown, with its rack.', 'ನಿಮ್ಮ ಗೋದಾಮಿನಲ್ಲಿರುವುದೆಲ್ಲ, ರ‍್ಯಾಕ್ ಜೊತೆ.'],
    ['Search to find one item fast.', 'ಒಂದು ಸಾಮಾನು ಬೇಗ ಹುಡುಕಲು ಹುಡುಕಿ.'],
    ['The keyboard opens. Nothing changes.', 'ಕೀಬೋರ್ಡ್ ತೆರೆಯುತ್ತದೆ. ಏನೂ ಬದಲಾಗುವುದಿಲ್ಲ.'],
  ),
  helpStep,
]);
