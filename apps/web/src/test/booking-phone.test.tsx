import {useState} from 'react';
import {expect,it} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {PhoneField} from '../booking/PhoneField';
import {validPhone} from '../booking/form';

function Example(){const [phone,setPhone]=useState('');return <><PhoneField label="Phone" value={phone} onChange={setPhone}/><output aria-label="Full phone">{phone}</output><button onClick={()=>setPhone('+1 202-555-0100')}>Load customer</button><button onClick={()=>setPhone('')}>Clear draft</button></>}
it('adds the selected country code exactly once and keeps an empty phone empty',()=>{
 render(<Example/>);expect(screen.getByRole('combobox',{name:'Phone country code'})).toHaveValue('91');expect(screen.getByLabelText('Full phone')).toBeEmptyDOMElement();
 fireEvent.change(screen.getByRole('textbox',{name:'Phone'}),{target:{value:'9876543210'}});expect(screen.getByLabelText('Full phone')).toHaveTextContent('+91 9876543210');expect(validPhone(screen.getByLabelText('Full phone').textContent!)).toBe(true);
 fireEvent.change(screen.getByRole('combobox',{name:'Phone country code'}),{target:{value:'44'}});expect(screen.getByLabelText('Full phone')).toHaveTextContent('+44 9876543210');
 fireEvent.change(screen.getByRole('textbox',{name:'Phone'}),{target:{value:''}});expect(screen.getByLabelText('Full phone')).toBeEmptyDOMElement();
});
it('accepts a full pasted number, preserves unknown international codes and follows external customer changes',()=>{
 render(<Example/>);const input=screen.getByRole('textbox',{name:'Phone'});
 fireEvent.change(input,{target:{value:'+971 50-123-4567'}});expect(screen.getByRole('combobox',{name:'Phone country code'})).toHaveValue('971');expect(input).toHaveValue('50-123-4567');expect(screen.getByLabelText('Full phone')).toHaveTextContent('+971 50-123-4567');
 fireEvent.change(input,{target:{value:'+49 15123456789'}});expect(screen.getByRole('combobox',{name:'Phone country code'})).toHaveValue('other');expect(input).toHaveValue('+49 15123456789');expect(validPhone(screen.getByLabelText('Full phone').textContent!)).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Load customer'}));expect(input).toHaveValue('202-555-0100');expect(screen.getByRole('combobox',{name:'Phone country code'})).toHaveValue('1');
 fireEvent.click(screen.getByRole('button',{name:'Clear draft'}));expect(input).toHaveValue('');expect(screen.getByLabelText('Full phone')).toBeEmptyDOMElement();
});
it('does not discard invalid phone characters and exposes an accessible field error',()=>{
 const view=render(<Example/>);fireEvent.change(screen.getByRole('textbox',{name:'Phone'}),{target:{value:'98765x4321'}});expect(validPhone(screen.getByLabelText('Full phone').textContent!)).toBe(false);
 view.rerender(<PhoneField label="Phone" value="+91 123" onChange={()=>{}} error="Check the phone number" disabled/>);expect(screen.getByRole('textbox',{name:'Phone'})).toHaveAccessibleDescription('Check the phone number');expect(screen.getByRole('textbox',{name:'Phone'})).toHaveAttribute('aria-invalid','true');expect(screen.getByRole('combobox',{name:'Phone country code'})).toBeDisabled();
});
