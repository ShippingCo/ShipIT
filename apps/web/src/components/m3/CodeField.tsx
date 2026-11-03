import type {CSSProperties} from 'react';
import {TextField, type TextFieldProps} from './Input';
import './code-field.css';

type CodeFieldProps = Omit<TextFieldProps, 'type' | 'inputMode' | 'autoComplete' | 'pattern' | 'minLength' | 'maxLength' | 'value'> & {
  digits: 6 | 8;
  value: string;
};

/** One native input preserves autofill, paste, selection and leading zeroes. */
export function CodeField({digits, value, ...props}: CodeFieldProps) {
  return <div className="verification-code" style={{'--code-length': digits} as CSSProperties}>
    <TextField {...props} value={value} type="password" inputMode="numeric" autoComplete="one-time-code"
      pattern={`[0-9]{${digits}}`} minLength={digits} maxLength={digits}/>
    <div className="verification-code-progress" aria-hidden="true">
      {Array.from({length:digits}, (_, index)=><span key={index} data-filled={index < value.length || undefined}/>)}
    </div>
  </div>;
}
