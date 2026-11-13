import React from 'react';
import { Msym, useRipple, cx } from './Icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'elevated';
  size?: 'sm' | 'lg';
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  block?: boolean;
  /** Swaps the leading icon for a spinner and disables the button. */
  loading?: boolean;
}

export function Button({ variant = 'filled', size, icon, trailingIcon, block, loading, className, children, ...rest }: ButtonProps) {
  const ripple = useRipple();
  return (
    <button
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', block && 'btn-block', className)}
      onPointerDown={ripple}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Msym name="progress_activity" className="spinner" /> : icon && <Msym name={icon} />}
      {children}
      {trailingIcon && <Msym name={trailingIcon} />}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  variant?: string;
  size?: 'sm';
  /** Draws the filled variant of the glyph. */
  filled?: boolean;
  /** Accessible name. Falls back to the icon name, which is better than nothing. */
  label?: string;
}

export function IconButton({ icon, variant, size, filled, label, className, ...rest }: IconButtonProps) {
  const ripple = useRipple();
  return (
    <button
      aria-label={label || String(icon)}
      title={label}
      className={cx('iconbtn', variant && `iconbtn-${variant}`, size === 'sm' && 'iconbtn-sm', className)}
      onPointerDown={ripple}
      {...rest}
    >
      <Msym name={icon} fill={filled} />
    </button>
  );
}

export interface FabProps {
  icon: React.ReactNode;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  style?: React.CSSProperties;
  className?: string;
}

export function Fab({ icon, children, onClick, style, className }: FabProps) {
  const ripple = useRipple();
  return (
    <button className={cx('fab', className)} onPointerDown={ripple} onClick={onClick} style={style}>
      <Msym name={icon} />
      <span className="t-label-lg">{children}</span>
    </button>
  );
}

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Accessible name for the group. Required when the control has no visible label beside it. */
  label?: string;
  /**
   * Render as a radiogroup rather than a group of toggles.
   *
   * A set of choices where exactly one is always true is a radiogroup, and a screen reader
   * announces it as "1 of 3" rather than reading three independent pressed states. It also
   * carries one tab stop and moves between options with the arrow keys, which is what a
   * keyboard user expects of a choice and not of a row of buttons.
   */
  radio?: boolean;
}

export function SegmentedControl<T extends string = string>({ options, value, onChange, className, label, radio = false }: SegmentedControlProps<T>) {
  const container = React.useRef<HTMLDivElement>(null);
  const move = (delta: number) => {
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    // Focus follows selection in a radiogroup, so the arrow key moves the ring as well as the choice.
    window.requestAnimationFrame(() => {
      container.current?.querySelectorAll<HTMLButtonElement>('.seg-btn')[options.indexOf(next)]?.focus();
    });
  };
  return (
    <div
      ref={container}
      className={cx('seg', className)}
      role={radio ? 'radiogroup' : 'group'}
      aria-label={label}
      onKeyDown={radio ? (event) => {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (!delta) return;
        event.preventDefault();
        move(delta);
      } : undefined}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={cx('seg-btn', selected && 'on')}
            role={radio ? 'radio' : undefined}
            aria-checked={radio ? selected : undefined}
            aria-pressed={radio ? undefined : selected}
            tabIndex={radio && !selected ? -1 : undefined}
            onClick={() => onChange(o.value)}
          >
            <Msym name="check" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface CheckboxProps {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Pushes the box to the far end of the row, for settings lists. */
  right?: boolean;
  ariaLabel?: string;
}

export function Checkbox({ checked, onChange, label, right, ariaLabel }: CheckboxProps) {
  return (
    <label className="check" style={right ? { justifyContent: 'space-between', width: '100%' } : undefined}>
      <input
        type="checkbox" checked={!!checked}
        aria-label={ariaLabel || (label ? undefined : 'Select')}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="box"><Msym name="check" /></span>
      {label ? <span>{label}</span> : null}
    </label>
  );
}
