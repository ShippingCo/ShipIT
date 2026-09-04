import React from 'react';
import { Msym, cx } from './Icon';
import { STATUS_FLOW } from '../../data/store';
import type { ParcelStatus, TimelineEntry } from '../../data/types';

/*
  Journey — the parcel's stage track.

  One node per stage of STATUS_FLOW, so the whole life of a parcel is readable in a
  single glance without reading a word: every stage carries its own icon, and the
  three states are told apart by fill, not by text.

    done    filled node, the stage icon crossfades to a check
    active  ringed node, a slow halo marks where the parcel is right now
    todo    hairline ring, muted icon

  An exception (failed attempt, return to sender) replaces the active node rather than
  adding a seventh stage — the parcel has not moved on, it has stalled where it is.

  Holds to the app's rules: white is the only background, one 1px hairline is the only
  border, and the single motion here points at the live stage instead of decorating.
*/

const STAGE = {
  booked: { icon: 'receipt_long', label: 'Booked' },
  checked_in: { icon: 'warehouse', label: 'At hub' },
  dispatched: { icon: 'local_shipping', label: 'Dispatched' },
  in_transit: { icon: 'alt_route', label: 'In transit' },
  out_for_delivery: { icon: 'moped', label: 'Out' },
  delivered: { icon: 'home', label: 'Delivered' },
};

const EXCEPTION = {
  failed_attempt: { icon: 'priority_high', label: 'Failed' },
  rto: { icon: 'keyboard_return', label: 'Returning' },
};

/* Latest timestamp recorded against each stage, so a done node can state when. */
function stampsOf(timeline) {
  const out = {};
  (timeline || []).forEach((t) => {
    if (t.status && (!out[t.status] || t.ts > out[t.status])) out[t.status] = t.ts;
  });
  return out;
}

export interface JourneyProps {
  status: ParcelStatus;
  timeline?: TimelineEntry[];
  /** Formats a timestamp for the step's caption. */
  format?: (ts: number) => string;
  className?: string;
}

export function Journey({ status, timeline, format, className }: JourneyProps) {
  const exception = EXCEPTION[status];
  /* A stalled parcel still sits at the last stage it reached. */
  const reached = exception
    ? Math.max(0, STATUS_FLOW.indexOf('out_for_delivery'))
    : Math.max(0, STATUS_FLOW.indexOf(status));
  const terminal = status === 'delivered';
  const stamps = stampsOf(timeline);

  return (
    <ol className={cx('jrn', exception && 'jrn-stalled', className)}
      aria-label={`Parcel stage: ${(exception || STAGE[status] || {}).label || status}`}>
      {STATUS_FLOW.map((key, i) => {
        const isLast = i === STATUS_FLOW.length - 1;
        const isException = Boolean(exception) && i === reached;
        /* Delivered is terminal: the last node settles as done, it does not keep pulsing. */
        const state = isException ? 'blocked'
          : i < reached || (i === reached && terminal) ? 'done'
          : i === reached ? 'active'
          : 'todo';
        const stage = isException ? exception : STAGE[key];
        const ts = stamps[key];

        return (
          <li key={key} className="jrn-step" data-state={state}>
            <span className="jrn-node" aria-hidden="true">
              <Msym name={stage.icon} className="jrn-ic" />
              <Msym name="check" className="jrn-check" />
            </span>
            {!isLast && <span className="jrn-link" aria-hidden="true" />}
            <span className="jrn-lbl">{stage.label}</span>
            {ts && format && state === 'done' && <span className="jrn-ts">{format(ts)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/*
  StepTrack — the same rail, driven by explicit steps instead of a parcel status.

  Used where the thing being tracked is a form rather than a shipment: a section is
  `done` once every field it owns validates, and the first unfinished section is the
  active one. Nothing here navigates — the whole form stays on one screen, because a
  clerk with a customer at the counter should never have to page back and forth. The
  track only answers "what is still missing before I can save?".
*/
export interface Step {
  key: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  /** True once every field this section owns validates. */
  done: boolean;
}

export interface StepTrackProps {
  steps: Step[];
  className?: string;
}

export function StepTrack({ steps, className }: StepTrackProps) {
  const firstOpen = steps.findIndex((s) => !s.done);
  return (
    <ol className={cx('jrn', className)}>
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        const state = s.done ? 'done' : i === firstOpen ? 'active' : 'todo';
        return (
          <li key={s.key} className="jrn-step" data-state={state}>
            <span className="jrn-node" aria-hidden="true">
              <Msym name={s.icon} className="jrn-ic" />
              <Msym name="check" className="jrn-check" />
            </span>
            {!isLast && <span className="jrn-link" aria-hidden="true" />}
            <span className="jrn-lbl">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
