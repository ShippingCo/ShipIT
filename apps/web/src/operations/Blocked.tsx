import React from 'react';
import {Msym} from '../components/m3/Icon';

export interface Blocker {
  /** What is missing, in the operator's words. */
  text: string;
  /** How to supply it: a control for someone who can, or plain words for someone who cannot. */
  fix?: React.ReactNode;
}

/**
 * Money screens repeatedly offered a form that could be filled in but never submitted — eight
 * of nine fields usable with the submit permanently dead, and the reason either absent or
 * buried in a status line elsewhere on the page. Showing the obstacle where the action would
 * have been is both the honest thing and the shorter path: nobody types into a form that
 * cannot be sent.
 *
 * Use it *instead of* the form, never above it.
 */
export function Blocked({title, blockers, children}: {title: string; blockers: Blocker[]; children?: React.ReactNode}) {
  return <section className="ops-blocked" role="note" aria-labelledby="ops-blocked-title">
    <div className="ops-blocked-head">
      <span className="ops-blocked-mark" aria-hidden="true"><Msym name="info"/></span>
      <h3 id="ops-blocked-title">{title}</h3>
    </div>
    <ul className="ops-blocked-list">
      {blockers.map((blocker, index) => <li key={index}>
        <span>{blocker.text}</span>
        {blocker.fix && <span className="ops-blocked-fix">{blocker.fix}</span>}
      </li>)}
    </ul>
    {children}
  </section>;
}
