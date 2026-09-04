import React from 'react';
import { Msym, useRipple, cx } from './Icon';
import type { ParcelStatus, RouteStatus } from '../../data/types';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Applies the standard card padding. Cards holding their own rows opt out. */
  pad?: boolean;
  /** Visual treatment, e.g. 'flat'. Passed through to the class name. */
  variant?: string;
}

export function Card({ pad, variant, className, children, style, ...rest }: CardProps) {
  return (
    <div className={cx('card', pad && 'card-pad', variant && `card-${variant}`, className)} style={style} {...rest}>
      {children}
    </div>
  );
}

const STATUS_LABELS: Record<ParcelStatus, string> = {
  booked: 'Booked',
  checked_in: 'Checked In',
  dispatched: 'Dispatched',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  failed_attempt: 'Delivery Failed',
  rto: 'Return to Sender',
};

export interface StatusPillProps {
  /**
   * A parcel status, or a route status where the pill is labelling a route. Route
   * statuses have no entry in the label map, so those callers pass labelOverride.
   */
  status: ParcelStatus | RouteStatus;
  /** Replaces the standard label where a screen needs its own wording. */
  labelOverride?: React.ReactNode;
}

export function StatusPill({ status, labelOverride }: StatusPillProps) {
  const label = STATUS_LABELS[status as ParcelStatus];
  return <span className={`pill st-${status}`}>{labelOverride || label || status}</span>;
}

export interface ChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'onClick'> {
  icon?: React.ReactNode;
  selected?: boolean;
  tonal?: boolean;
  onRemove?: () => void;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
}

export function Chip({ icon, selected, tonal, onRemove, onClick, className, children, ...rest }: ChipProps) {
  const ripple = useRipple();
  return (
    <span
      className={cx('chip', tonal && 'chip-tonal', selected && 'chip-selected', onClick && 'chip-click', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onPointerDown={onClick ? ripple : undefined}
      {...rest}
    >
      {(selected || icon) && <Msym name={selected ? 'check' : icon} />}
      {children}
      {onRemove && (
        <button className="chip-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove">
          <Msym name="close" />
        </button>
      )}
    </span>
  );
}

export interface ListItemProps {
  leading?: React.ReactNode;
  headline?: React.ReactNode;
  sub?: React.ReactNode;
  trail?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  className?: string;
  children?: React.ReactNode;
}

export function ListItem({ leading, headline, sub, trail, onClick, className, children }: ListItemProps) {
  return (
    <div className={cx('li', onClick && 'clickable', className)} onClick={onClick}>
      {leading}
      <div className="u-grow">
        <div className="li-head">{headline}</div>
        {sub && <div className="li-sub">{sub}</div>}
        {children}
      </div>
      {trail}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ icon = 'inbox', title, sub, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-icon"><Msym name={icon} /></div>
      <h4>{title}</h4>
      {sub && <p>{sub}</p>}
      {action}
    </div>
  );
}
