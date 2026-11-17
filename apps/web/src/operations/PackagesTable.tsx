import React from 'react';
import {Checkbox} from '../components/ui/checkbox';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '../components/ui/dropdown-menu';
import {Msym} from '../components/m3/Icon';
import type {SavedBookingRow} from './SavedBookings';

/**
 * The Packages list, adapted from the 21st.dev "Data Table" (ephraimduncan/table-05):
 * one dense row per parcel, a small checkbox column, soft tinted status badges, a
 * right-aligned amount and a per-row actions menu, built on the project's own shadcn
 * primitives rather than TanStack, because sorting and selection already live in the
 * page that owns this table.
 *
 * Every cell is a single line that truncates rather than wraps. The previous table let
 * names, phone numbers and lot codes wrap onto three and four lines, so a screen held
 * five parcels and the row action was clipped off the right edge.
 */

type Tone='neutral'|'info'|'progress'|'warning'|'success'|'danger'|'draft';
const statusTone:Record<string,Tone>={draft:'draft',booked:'neutral',checked_in:'info',dispatched:'progress',in_transit:'progress',out_for_delivery:'progress',
  failed_attempt:'warning',held_at_office:'warning',delivered:'success',rto:'danger',cancelled:'neutral'};
const statusLabel:Record<string,string>={draft:'Draft — not booked',booked:'Booked',checked_in:'Checked In',dispatched:'Dispatched',in_transit:'In Transit',
  out_for_delivery:'Out for Delivery',failed_attempt:'Delivery Failed',held_at_office:'At office',delivered:'Delivered',rto:'Return to Sender',cancelled:'Cancelled'};

function Badge({tone,dot,children}:{tone:Tone;dot?:boolean;children:React.ReactNode}){
  return <span className={'pkg-badge tone-'+tone}>{dot&&<i aria-hidden="true"/>}{children}</span>;
}
export const paymentBadge=(row:SavedBookingRow)=>row.payment==='paid'
  ?<Badge tone="success">Paid</Badge>
  :row.payment==='topay'?<Badge tone="warning">To Pay</Badge>:<Badge tone="neutral">Not recorded</Badge>;
export const statusBadge=(row:SavedBookingRow)=><Badge tone={statusTone[row.status]??'neutral'} dot>{statusLabel[row.status]??row.status.replaceAll('_',' ')}</Badge>;

export type RowAction={kind:'check_in'|'dispatch'|'finish';label:string;icon:string};
export function nextAction(row:SavedBookingRow):RowAction|null{
  if(row.parcel&&row.status==='booked')return {kind:'check_in',label:'Check in',icon:'warehouse'};
  if(row.parcel&&row.status==='checked_in')return {kind:'dispatch',label:'Add to trip',icon:'local_shipping'};
  if(row.entry)return {kind:'finish',label:'Finish',icon:'edit'};
  return null;
}

const money=(paise:number|null)=>paise===null?'—':'₹'+(paise/100).toLocaleString('en-IN',{maximumFractionDigits:2});
// Business times are always India time, whatever the browser's own clock says.
const when=(ts:number)=>Number.isFinite(ts)?new Date(ts).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}):'';

export function PackagesTable({rows,picked,onPick,allShown,onPickAll,busy,sortIcon,onSort,onOpen,onAction,actions}:{
  rows:SavedBookingRow[];picked:Record<string,boolean>;onPick:(id:string,value:boolean)=>void;
  allShown:boolean;onPickAll:(value:boolean)=>void;busy:boolean;
  sortIcon:(key:string)=>string;onSort:(key:'docket'|'amount')=>void;
  onOpen:(id:string)=>void;onAction:(row:SavedBookingRow,action:RowAction)=>void;
  /** False where the screen has no operational sheet to open, so rows carry no action. */
  actions:boolean;
}){
  const some=rows.some(row=>picked[row.id]);
  return <div className="pkg-tbl-wrap">
    <table className="pkg-tbl" aria-label="Packages">
      <colgroup>
        <col className="c-check"/><col className="c-docket"/><col className="c-customer"/><col className="c-to"/>
        <col className="c-amount"/><col className="c-pay"/><col className="c-status"/>{actions&&<col className="c-act"/>}
      </colgroup>
      <thead><tr>
        <th className="c-check"><Checkbox className="pkg-check" checked={allShown?true:some?'indeterminate':false}
          onCheckedChange={value=>{if(!busy)onPickAll(value===true);}} aria-label="Select all shown bookings"/></th>
        <th><button type="button" className="pkg-sort" onClick={()=>onSort('docket')}>Docket <Msym name={sortIcon('docket')}/></button></th>
        <th>Customer</th><th>To · Lot</th>
        <th className="ta-r"><button type="button" className="pkg-sort is-r" onClick={()=>onSort('amount')}>Amount <Msym name={sortIcon('amount')}/></button></th>
        <th>Payment</th><th>Status</th>
        {actions&&<th className="c-act"><span className="workspace-visually-hidden">Next step</span></th>}
      </tr></thead>
      <tbody>{rows.map(row=>{
        const action=actions?nextAction(row):null;
        return <tr key={row.id} tabIndex={0} data-state={picked[row.id]?'selected':undefined} onClick={()=>onOpen(row.id)}
          onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onOpen(row.id);}}}>
          <td className="c-check" onClick={event=>event.stopPropagation()}>
            <Checkbox className="pkg-check" checked={!!picked[row.id]} onCheckedChange={value=>{if(!busy)onPick(row.id,value===true);}} aria-label={'Select '+row.docket}/>
          </td>
          <td><span className="pkg-line pkg-mono" title={row.docket}>{row.docket}</span><span className="pkg-sub">{when(row.createdAt)}</span></td>
          <td><span className="pkg-line pkg-strong" title={row.name}>{row.name}</span><span className="pkg-sub">{row.phone||'—'}</span></td>
          {/* Where it goes, with the lot it rides in underneath. */}
          <td><span className="pkg-line" title={row.city||undefined}>{row.city||'—'}</span><span className="pkg-sub" title={row.lotCode||undefined}>{row.lotCode?<><Msym name="layers"/>{row.lotCode}</>:'No lot'}</span></td>
          <td className="ta-r"><span className="pkg-amount" title={row.entry?'Entered charges; tax not assessed':undefined}>{money(row.amount)}</span></td>
          <td>{paymentBadge(row)}</td>
          <td>{statusBadge(row)}</td>
          {actions&&<td className="c-act" onClick={event=>event.stopPropagation()}>
            <div className="pkg-act">
              {action&&<button type="button" className="pkg-act-btn" disabled={busy&&action.kind!=='finish'}
                onClick={()=>onAction(row,action)} aria-label={(action.kind==='finish'?'Finish draft ':action.label+' ')+row.docket}>
                <Msym name={action.icon}/><span className="pkg-act-label">{action.label}</span></button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="pkg-more" aria-label={'More for '+row.docket}><Msym name="more_vert"/></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="pkg-menu">
                  <DropdownMenuItem onSelect={()=>onOpen(row.id)}><Msym name="open_in_new"/>Open details</DropdownMenuItem>
                  {action&&<DropdownMenuItem disabled={busy&&action.kind!=='finish'} onSelect={()=>onAction(row,action)}><Msym name={action.icon}/>{action.label}</DropdownMenuItem>}
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem onSelect={()=>{void navigator.clipboard?.writeText(row.docket).catch(()=>{});}}><Msym name="tag"/>Copy docket</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </td>}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
