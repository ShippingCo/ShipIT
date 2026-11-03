import type React from 'react';
import {Msym,cx} from './Icon';
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
