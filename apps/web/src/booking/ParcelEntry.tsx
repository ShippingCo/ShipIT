import {type ReactNode,useId,useState} from 'react';
import {TextField,SelectField} from '../components/m3/Input';
import {Msym} from '../components/m3/Icon';
import {ConfirmDialog} from '../components/m3/Dialog';
import {PhoneField} from './PhoneField';
import {UnitField,displayUnits} from './UnitField';
import {WeightField,ParcelSize} from './WeightField';
import {parcelErrors,receiverFields,type Errors,type ParcelDraft} from './form';

const contentsTypes = [
  {value:'solid',label:'Solid goods'}, {value:'documents',label:'Documents'},
  {value:'liquid',label:'Liquid'}, {value:'semi_liquid',label:'Semi-liquid'}, {value:'other',label:'Other'},
];

export function ParcelEntry({parcel,number,errors,disabled,onChange,onRemove,earlier=[],copyReceiver,primaryFields,hideReceiver=false}:{primaryFields?:ReactNode;hideReceiver?:boolean;
  parcel:ParcelDraft; number:number; errors:Errors; disabled:boolean;
  onChange:(field:keyof ParcelDraft,value:string)=>void; onRemove?:()=>void; earlier?:readonly ParcelDraft[]; copyReceiver?:(sourceNumber:number)=>boolean;
}) {
  const first=number===1;
  const fieldsId=useId();
  const [selectedSource,setSelectedSource]=useState(''),[replaceOpen,setReplaceOpen]=useState(false),[copiedFrom,setCopiedFrom]=useState<number|null>(null);
  const choices=earlier.flatMap((p,i)=>receiverFields.some(key=>key!=='recipientCountry'&&p[key].trim())?[{value:String(i+1),label:['Parcel '+(i+1),p.recipientName.trim(),p.recipientCity.trim(),p.docket.trim().toUpperCase()].filter(Boolean).join(' · ')}]:[]);
  const sourceNumber=Number(choices.find(c=>c.value===selectedSource)?.value??choices[0]?.value);
  const source=earlier[sourceNumber-1];
  const identical=source&&receiverFields.every(key=>parcel[key]===source[key]);
  const conflicts=source&&receiverFields.some(key=>parcel[key].trim()!==''&&parcel[key]!==source[key]);
  function applyCopy(){
    if(copyReceiver?.(sourceNumber))setCopiedFrom(sourceNumber);
  }
  const [compact,setCompact]=useState(false);
  const complete=Object.keys(parcelErrors(parcel)).length===0 && !Object.values(errors).some(Boolean);
  const collapsed=compact&&complete;
  const id=(field:keyof ParcelDraft)=>first?'counter-'+field:'counter-package-'+(number-2)+'-'+field;
  const label=(firstLabel:string,otherLabel:string)=>first?firstLabel:'Parcel '+number+' '+otherLabel;
  const props=(field:keyof ParcelDraft)=>({id:id(field),value:parcel[field],disabled,error:errors[field],onChange:(value:string)=>onChange(field,value)});
  return <fieldset className="booking-parcel-entry">
    <legend><Msym name="inventory_2"/>Parcel {number}</legend>
    {complete&&<div className="parcel-fold-toolbar">
      <p><strong>{parcel.docket.trim().toUpperCase()}</strong><span>{parcel.recipientName.trim()||parcel.recipientCity} · {displayUnits(parcel.weight,3)} kg</span></p>
      <button type="button" className="btn btn-text" aria-controls={fieldsId} aria-expanded={!collapsed} onClick={()=>setCompact(!compact)}>{collapsed?'Edit parcel':'Hide parcel fields'} {number}<Msym name={collapsed?'expand_more':'expand_less'}/></button>
    </div>}
    <div id={fieldsId} hidden={collapsed}>
    {primaryFields}
    <div className="counter-grid">
      {!primaryFields&&<><TextField {...props('docket')} label={label('Docket number','docket number')} maxLength={32} autoComplete="off" spellCheck={false} autoCapitalize="characters"/>
      <WeightField id={id('weight')} label={first?'Weight':'Package '+number+' · Weight'} value={parcel.weight} unit={parcel.weightUnit} disabled={disabled}
        error={errors.weight?'Enter a positive weight, greater than zero.':undefined}
        onChange={value=>onChange('weight',value)} onUnit={value=>onChange('weightUnit',value)}/></>}
      <SelectField {...props('contentsType')} label={label('Contents type','contents type')} options={contentsTypes}/>
      <TextField {...props('contentsDescription')} label={label('Contents description','contents description')} maxLength={200} placeholder="e.g. Cotton shirts"/>
      {['liquid','semi_liquid'].includes(parcel.contentsType)&&
        <UnitField {...props('liquidQuantity')} places={3} label={label('Liquid quantity (litres)','liquid quantity (litres)')}/>}
      {!primaryFields&&<ParcelSize parcel={parcel} disabled={disabled} errors={errors} idFor={id} labelFor={side=>label(side,side.toLowerCase())} onChange={onChange}/>}
      {!primaryFields&&<UnitField {...props('declaredValue')} places={2} label={label('Declared goods value (₹)','declared goods value (₹)')} helper="Optional"/>}
    </div>
    {!hideReceiver&&<>
    <h3 className="parcel-receiver-heading"><Msym name="pin_drop"/>Receiver {first?'':'for parcel '+number}<small className="booking-receiver-country">India</small></h3>
    {!first&&choices.length>0&&<div className="booking-copy-receiver">
      {choices.length===1&&source&&<span className="counter-help">{[source.recipientName.trim(),source.recipientCity.trim()].filter(Boolean).join(' · ')}</span>}
      {choices.length>1&&<SelectField label={'Copy receiver for parcel '+number+' from'} value={String(sourceNumber)} options={choices} onChange={setSelectedSource} disabled={disabled}/>}
      <button className="btn btn-outlined" type="button" disabled={disabled||identical} onClick={()=>{if(conflicts)setReplaceOpen(true);else applyCopy();}}>Use receiver from parcel {sourceNumber}</button>
      {identical&&copiedFrom===sourceNumber&&<p className="counter-help" role="status">Copied from parcel {sourceNumber}. Check the receiver and address below.</p>}
      <ConfirmDialog open={replaceOpen} onClose={()=>setReplaceOpen(false)} title={'Replace receiver on parcel '+number+'?'} body={'Copy the receiver and delivery address from parcel '+sourceNumber+'. Fields left blank on the source parcel will also be blank here. Your docket, contents and weight stay saved in this draft.'} confirmLabel="Replace receiver" onConfirm={applyCopy}/>
    </div>}
    <div className="counter-grid booking-address-grid">
      <TextField {...props('recipientName')} label={label('Recipient name','recipient name')} helper="Optional" maxLength={120}/>
      <PhoneField {...props('recipientPhone')} label={label('Recipient phone','recipient phone')} helper="Optional. Add a number for delivery updates and the recipient code."/>
      <TextField {...props('recipientAddress')} label={label('Recipient address','recipient address')} maxLength={500} className="booking-span" placeholder="Building, street and area"/>

      <TextField {...props('recipientPin')} label={label('PIN code','PIN code')} inputMode="numeric" maxLength={6}/>
      <TextField {...props('recipientCity')} label={label('City','city')} maxLength={80}/>
      <TextField {...props('recipientRegion')} label={label('State / region','state')} maxLength={80}/>
    </div>
    </>}
    </div>
    {onRemove&&<button type="button" className="btn btn-text" disabled={disabled} onClick={onRemove}>Remove package {number}</button>}
  </fieldset>;
}
