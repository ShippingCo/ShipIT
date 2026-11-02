import React,{useState} from 'react';
import {expect,it,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {TextArea} from '../components/m3/Input';
import {SettingEditor,buildSetting} from '../operations/SettingEditor';
import type {SettingsDraft} from '../data-access/settings-session';

it('keeps bounded multiline inputs labelled, described and locked during a request',()=>{
 const change=vi.fn();render(<><p id="private-note">Staff only</p><TextArea id="reply" label="Reply" value="Draft" onChange={change} disabled required maxLength={2000} aria-describedby="private-note" helper="No delivery codes."/></>);
 const input=screen.getByRole('textbox',{name:'Reply'});expect(input).toBeDisabled();expect(input).toBeRequired();expect(input).toHaveAttribute('maxlength','2000');expect(input).toHaveAccessibleDescription('Staff only No delivery codes.');expect(input).toHaveAttribute('id','reply');
});
it('adds and removes holiday dates with date inputs without guessing operating days or duplicating dates',()=>{
 let latest:SettingsDraft={owner:'franchise',key:'collection_calendar',expected_version:0,fields:{day1:'yes',holidays:''},reason:'Reviewed',clear:false,confirmed:false,dirty:false};
 function Editor(){const [draft,setDraft]=useState(latest);return <SettingEditor draft={draft} change={next=>{latest=next;setDraft(next);}} locked={false} scopes={[]} more={false} loadMore={()=>{}} financial={{accounts:[],terms:[],policy:null}} financialMore={false} loadFinancial={()=>{}}/>;}
 render(<Editor/>);const input=screen.getByLabelText('Add holiday date');expect(input).toHaveAttribute('type','date');expect(screen.getByRole('button',{name:'Add holiday'})).toBeDisabled();
 fireEvent.change(input,{target:{value:'2026-11-14'}});fireEvent.click(screen.getByRole('button',{name:'Add holiday'}));expect(buildSetting(latest)).toEqual({timezone:'Asia/Kolkata',weekdays:[1],holidays:['2026-11-14']});
 fireEvent.change(input,{target:{value:'2026-11-14'}});fireEvent.click(screen.getByRole('button',{name:'Add holiday'}));expect(screen.getByText('This date is already included.')).toBeVisible();expect(latest.fields.holidays).toBe('2026-11-14');
 fireEvent.click(screen.getByRole('button',{name:'Remove holiday 2026-11-14'}));expect(buildSetting(latest)).toEqual({timezone:'Asia/Kolkata',weekdays:[1],holidays:[]});expect(latest.reason).toBe('Reviewed');
});
