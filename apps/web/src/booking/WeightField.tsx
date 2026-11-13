import {TextField} from '../components/m3/Input';
import {SegmentedControl} from '../components/m3/Button';
import {UnitField,displayUnits} from './UnitField';
import {billedWeight,type Errors,type ParcelDraft} from './form';

/**
 * The weight of one parcel, and what it is actually charged on.
 *
 * Two things live here that used to be missing from the counter.
 *
 * The unit is a choice, not a fixed label. The field was kilograms only, so a 350 g envelope
 * was typed as "0.35" — a decimal point, at a counter, with a queue. An operator who means
 * grams now says grams, and the stored value is whole grams either way: switching the unit
 * never changes the parcel, only what the field shows.
 *
 * The size is optional and changes the price when it matters. A courier bills the greater of
 * what the scale reads and what the parcel takes up on the vehicle, and until now the counter
 * had no way to say so. When the size wins, the screen says which number is being charged and
 * why, in the parcel's own figures — never as a formula, because an operator repeating a
 * division to a customer loses the argument.
 */

const units=[{value:'kg',label:'kg'},{value:'g',label:'g'}];

export function WeightField({id,label,value,unit,disabled,error,onChange,onUnit}:{
  id:string; label:string; value:string; unit:string; disabled:boolean; error?:string;
  onChange:(value:string)=>void; onUnit:(unit:string)=>void;
}) {
  const grams=unit==='g';
  return <div className="parcel-weight">
    {grams
      ?<TextField id={id} label={label+' (g)'} value={/^[0-9]*$/.test(value)?value:value.replace(/^invalid-decimal:/,'')}
        inputMode="numeric" disabled={disabled} error={error} placeholder="e.g. 350"
        onChange={text=>onChange(/^[0-9]+$/.test(text)||text===''?text:'invalid-decimal:'+text)}/>
      :<UnitField id={id} label={label+' (kg)'} places={3} value={value} disabled={disabled} error={error} placeholder="e.g. 0.5"
        onChange={onChange}/>}
    <SegmentedControl radio className="seg-unit" label={label+' unit'} options={units} value={grams?'g':'kg'}
      onChange={next=>{if(!disabled)onUnit(next);}}/>
  </div>;
}

/**
 * Length, width and height in whole centimetres, and the one sentence they are for.
 *
 * Nothing here is required, and nothing here is sent to the server: the parcel record keeps
 * what the scale read. These three numbers exist so the price is right and so the operator
 * can say out loud why it is right.
 */
export function ParcelSize({parcel,idFor,labelFor,disabled,errors,onChange}:{
  parcel:Pick<ParcelDraft,'weight'|'weightUnit'|'lengthCm'|'widthCm'|'heightCm'>;
  idFor:(field:'lengthCm'|'widthCm'|'heightCm')=>string;
  labelFor:(side:string)=>string;
  disabled:boolean; errors:Errors; onChange:(field:'lengthCm'|'widthCm'|'heightCm',value:string)=>void;
}) {
  const sides=[['lengthCm','Length'],['widthCm','Width'],['heightCm','Height']] as const;
  const billed=billedWeight(parcel);
  const shown=(grams:string)=>displayUnits(grams,3)+' kg';
  return <div className="parcel-size booking-span">
    <p className="parcel-size-head" id={idFor('lengthCm')+'-head'}>Parcel size <span>Optional — only needed for a large, light parcel</span></p>
    <div className="parcel-size-fields" role="group" aria-labelledby={idFor('lengthCm')+'-head'}>
      {sides.map(([field,name],index)=><div key={field} className="parcel-size-cell">
        {index>0&&<span className="parcel-size-x" aria-hidden="true">×</span>}
        <TextField id={idFor(field)} label={labelFor(name)+' (cm)'} value={parcel[field]} inputMode="numeric" maxLength={3}
          disabled={disabled} error={errors[field]} onChange={text=>onChange(field,text.replace(/[^0-9]/g,''))}/>
      </div>)}
    </div>
    {billed&&billed.volumetric!==null&&<p className={'parcel-billed'+(billed.basis==='size'?' is-size':'')} role="status">
      {billed.basis==='size'
        ?<><strong>{shown(billed.grams)} billed (by size)</strong> — this parcel takes up the room of {shown(billed.volumetric)}, though the scale reads {shown(billed.actual)}.</>
        :<><strong>{shown(billed.grams)} billed (by weight)</strong> — the scale reads more than the parcel takes up ({shown(billed.volumetric)}), so the size does not change the price.</>}
    </p>}
  </div>;
}
