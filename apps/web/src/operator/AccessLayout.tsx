import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {CounterScene, DispatchScene, HandoverScene} from './access-illustrations';
import {stages} from '../public/catalog';
import './counter-identity.css';

/**
 * The three stages a parcel passes through, and the WhatsApp update the customer gets at each.
 * The update names are message kinds the product sends (README: booking confirmation,
 * out-for-delivery, delivery). They are labels for the drawing, not anyone's real messages.
 */
const chapters = [
  {...stages[0], Scene: CounterScene, update: 'Booking confirmed'},
  {...stages[1], Scene: DispatchScene, update: 'Out for delivery'},
  {...stages[2], Scene: HandoverScene, update: 'Delivered'},
];

export function ParcelMark() {
  return <svg viewBox="0 0 40 40" width="36" height="36" fill="none" aria-hidden="true">
    <rect width="40" height="40" rx="10" fill="#174bb6"/>
    <path d="m8 15 12-6 12 6-12 6zM8 19l12 6 12-6M8 23l12 6 12-6" stroke="white" strokeWidth="2.25" strokeLinejoin="round"/>
  </svg>;
}

/** WhatsApp's two read ticks, drawn small enough to sit inside a message bubble. */
function ReadTicks() {
  return <svg viewBox="0 0 18 12" width="18" height="12" fill="none" aria-hidden="true" className="route-ticks">
    <path d="m1 6.5 3 3L10.5 3M7 9.5 13.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

/**
 * What the software does, as the route a parcel takes.
 *
 * The panel used to be a dark grey slab holding one scene, one sentence and three thin
 * segments. It is now the brand's own navy, on a faint grid like a route map, and it tells one
 * story: the parcel moves from the counter to the door, and at every stop the customer gets the
 * WhatsApp update without anyone at the shop sending it. The route moves only when the stage
 * changes (on its own every seven seconds, or the moment a person picks a stop, after which it
 * stays where they put it): the next leg fills in amber and that stop's message arrives. Adapted from the
 * 21st.dev "Split Login" (login-03) layout and "Vertical How It Works Timeline"
 * (how-it-works-02) pattern, both used as patterns only.
 */
function RoutePanel() {
  const [chapter, setChapter] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => { if (!paused.current) setChapter(index => (index + 1) % chapters.length); }, 7000);
    return () => window.clearInterval(timer);
  }, []);
  const choose = (index: number) => { paused.current = true; setChapter(index); };
  return <aside className="access-panel" aria-label="What ShippingCo does">
    <div className="panel-stage">
      {chapters.map((item, index) =>
        <div key={item.name} className={'panel-slide' + (index === chapter ? ' is-on' : '')} aria-hidden={index !== chapter}>
          <item.Scene/>
        </div>)}
    </div>
    <p className="panel-headline">Book it once. Every update after that reaches your customer on WhatsApp.</p>
    <ol className="route" aria-label="A parcel’s route">
      {chapters.map((item, index) => {
        const reached = index <= chapter, now = index === chapter, passed = index < chapter;
        return <li key={item.name} className={'route-stop' + (reached ? ' is-reached' : '') + (now ? ' is-now' : '') + (passed ? ' is-passed' : '')}>
          <button type="button" className="route-pick" aria-pressed={now} onClick={() => choose(index)}>
            <span className="route-node" aria-hidden="true"/>
            <span className="route-text">
              <span className="route-name">{item.name}</span>
              <span className="route-caption">{item.caption}</span>
            </span>
          </button>
          {/* Kept in the layout before it arrives, so the panel never jumps when it does. */}
          <p className="route-update" aria-hidden={!reached}>
            <span className="workspace-visually-hidden">The customer gets on WhatsApp: </span>
            {item.update}<ReadTicks/>
          </p>
        </li>;
      })}
    </ol>
  </aside>;
}

/**
 * The brand goes back to the public site: a person who reached sign-in by mistake, or whose
 * session ended, can still find out what ShippingCo is and which plan to choose.
 */
export function AccessLayout({children,after}:{children:ReactNode;after?:ReactNode}) {
  return <main className="access-layout">
    <Link to="/" className="access-brand" aria-label="ShippingCo home"><ParcelMark/><strong>ShippingCo</strong></Link>
    <div className="access-task"><div className="access-task-stack">{children}{after}</div></div>
    <RoutePanel/>
  </main>;
}
