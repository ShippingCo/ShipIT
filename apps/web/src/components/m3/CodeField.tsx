import type {CSSProperties} from 'react';
import {TextField, type TextFieldProps} from './Input';
import './code-field.css';

type CodeFieldProps = Omit<TextFieldProps, 'type' | 'inputMode' | 'autoComplete' | 'pattern' | 'minLength' | 'maxLength' | 'value'> & {
  digits: 6 | 8;
  value: string;
  /** Show the digits instead of masking them. Only where the typist received the code. */
  reveal?: boolean;
};

/**
 * One native input preserves autofill, paste, selection and leading zeroes.
 *
 * Masked by default, and shown where `reveal` is set. The two cases are genuinely different.
 * Signing in, the code is already on the phone in the operator’s other hand and dies in ten
 * minutes, so masking it defends against nothing and charges a retry for every mistype. At a
 * door, the agent types a code the *recipient* received, and the field is that recipient’s
 * proof of delivery — so it stays masked.
 */
export function CodeField({digits, value, reveal, ...props}: CodeFieldProps) {
  return <div className="verification-code" style={{'--code-length': digits} as CSSProperties}>
    <TextField {...props} value={value} type={reveal?'text':'password'} inputMode="numeric" autoComplete="one-time-code"
      pattern={`[0-9]{${digits}}`} minLength={digits} maxLength={digits}/>
    <div className="verification-code-progress" aria-hidden="true">
      {Array.from({length:digits}, (_, index)=><span key={index} data-filled={index < value.length || undefined}/>)}
    </div>
  </div>;
}
