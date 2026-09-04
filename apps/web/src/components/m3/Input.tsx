import React from 'react';
import { Msym, cx } from './Icon';

/* Every field in this file is controlled and reports its value as a string. Parsing to
   a number is the caller’s job, because the caller is the one that knows whether an
   empty box means zero or means “not filled in yet”. */

export interface FieldBase {
  label?: React.ReactNode;
  /** Message shown in place of the helper, and turns the field red. */
  error?: React.ReactNode;
  helper?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface TextFieldProps
  extends FieldBase,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, keyof FieldBase | 'onChange' | 'value'> {
  value?: string | number | null;
  onChange: (value: string) => void;
  /** Trailing Material Symbols glyph name. */
  trailing?: React.ReactNode;
}

export function TextField({ label, value, onChange, type = 'text', error, helper, trailing, list, className, style, onBlur, ...rest }: TextFieldProps) {
  const [focused, setFocused] = React.useState(false);
  const float = focused || String(value ?? '') !== '' || ['date', 'datetime-local'].includes(type);
  return (
    <label className={cx('tf', error && 'err', float && 'float', trailing && 'has-trail', className)} style={style}>
      <span className="tf-label">{label}</span>
      <span className="tf-box">
        <input
          type={type} value={value ?? ''} list={list}
          aria-invalid={error ? true : undefined}
          onFocus={() => setFocused(true)}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {trailing && <span className="tf-trail"><Msym name={trailing} /></span>}
      </span>
      {(error || helper) && (
        <span className="tf-help">
          {error && <Msym name="error" />}
          {error || helper}
        </span>
      )}
    </label>
  );
}

export interface TextAreaProps extends FieldBase {
  value?: string | null;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
}

export function TextArea({ label, value, onChange, rows = 3, placeholder, error, helper, className, style, onBlur }: TextAreaProps) {
  const [focused, setFocused] = React.useState(false);
  return (
    <label className={cx('tf', error && 'err', (focused || value) && 'float', className)} style={style}>
      <span className="tf-label">{label}</span>
      <span className="tf-box">
        <textarea
          rows={rows} value={value ?? ''} placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onFocus={() => setFocused(true)} onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      {(error || helper) && (
        <span className="tf-help">
          {error && <Msym name="error" />}
          {error || helper}
        </span>
      )}
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export interface SelectFieldProps
  extends FieldBase,
    Omit<React.SelectHTMLAttributes<HTMLSelectElement>, keyof FieldBase | 'onChange' | 'value'> {
  value?: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  /**
   * Accepted and ignored. A select always shows the chevron, so this exists only so
   * that callers can pass the same prop they pass to TextField without it falling
   * through the rest spread onto the <select> element as an invalid DOM attribute.
   */
  trailing?: React.ReactNode;
}

export function SelectField({ label, value, onChange, options, error, helper, className, style, onBlur, trailing: _trailing, ...rest }: SelectFieldProps) {
  const [focused, setFocused] = React.useState(false);
  const float = focused || String(value ?? '') !== '';
  return (
    <label className={cx('tf', error && 'err', float && 'float', 'has-trail', className)} style={style}>
      <span className="tf-label">{label}</span>
      <span className="tf-box">
        <select
          value={value ?? ''}
          aria-invalid={error ? true : undefined}
          onFocus={() => setFocused(true)} onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="tf-trail"><Msym name="expand_more" /></span>
      </span>
      {(error || helper) && (
        <span className="tf-help">
          {error && <Msym name="error" />}
          {error || helper}
        </span>
      )}
    </label>
  );
}

export interface SwitchRowProps {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  headline?: React.ReactNode;
  sub?: React.ReactNode;
  disabled?: boolean;
}

export function SwitchRow({ checked, onChange, headline, sub, disabled }: SwitchRowProps) {
  const labelId = React.useId();
  return (
    <div className="u-between" style={{ padding: '10px 0', gap: 16 }}>
      <div>
        <div id={labelId} className="t-body-md" style={{ fontWeight: 500 }}>{headline}</div>
        {sub && <div className="t-body-sm muted">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        className={cx('switch', checked && 'on')}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}
