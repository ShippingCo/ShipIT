import {expect,it} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import {decimalUnits,displayUnits,UnitField} from '../booking/UnitField';
import {publishedChoices} from '../booking/RateChoices';
import {rateCard} from './counter-fixture';

it('converts kg and rupees exactly at fractional and safe-integer boundaries',()=>{
 expect(decimalUnits('0.001',3)).toBe('1');expect(decimalUnits('0.999',3)).toBe('999');
 expect(decimalUnits('1.005',3)).toBe('1005');expect(decimalUnits('100.01',2)).toBe('10001');
 expect(decimalUnits('9007199254740.991',3)).toBe('9007199254740991');
 expect(decimalUnits('9007199254740.992',3)).toBeNull();
 for(const invalid of ['1e3','-1','Infinity','0.0001','.5',' 1','1,000'])expect(decimalUnits(invalid,3)).toBeNull();
 expect(decimalUnits('1.001',2)).toBeNull();
 expect(displayUnits('1005',3)).toBe('1.005');expect(displayUnits('10000',2)).toBe('100');
});
it('retains partial decimal editing and updates after an external draft change',()=>{
 function Example(){const [grams,setGrams]=useState('500');return <><UnitField label="Weight" value={grams} places={3} onChange={setGrams}/><output aria-label="grams">{grams}</output><button onClick={()=>setGrams('1250')}>Change source</button></>}
 render(<Example/>);const input=screen.getByLabelText('Weight');
 expect(input).toHaveValue('0.5');fireEvent.change(input,{target:{value:'1.'}});expect(input).toHaveValue('1.');expect(screen.getByLabelText('grams')).toHaveTextContent('1000');
 fireEvent.change(input,{target:{value:'1.005'}});expect(screen.getByLabelText('grams')).toHaveTextContent('1005');
 fireEvent.click(screen.getByRole('button',{name:'Change source'}));expect(input).toHaveValue('1.25');
 fireEvent.change(input,{target:{value:'1e3'}});expect(input).toHaveValue('1e3');expect(screen.getByLabelText('grams')).toHaveTextContent('invalid-decimal');
});
it('accepts only published rate choices and discards unneeded pricing details',()=>{
 const parsed=publishedChoices(rateCard);expect(parsed.rules).toEqual([{destination_key:'SYN_DEST',service:'standard'}]);
 expect(parsed).not.toHaveProperty('approval_ref');expect(parsed.rules[0]).not.toHaveProperty('freight_paise');
 expect(()=>publishedChoices({...rateCard,state:'draft'})).toThrow();
 expect(()=>publishedChoices({...rateCard,rules:[{destination_key:'SYN_DEST',service:'unknown'}]})).toThrow();
});
