import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import type {LotDto} from '@shippingco/shared';
import type {BookingConfirmation} from '../data-access/bookings';
import type {CommandIntent} from '../data-access/command-intent';
import {ApiFailure,recoveryFor} from '../data-access/errors';
import {lots} from '../data-access/lots';
import type {ScopedApi} from '../data-access/scoped-api';
import {SelectField} from '../components/m3/Input';
import {usePagedResource} from '../operations/hooks';

type Assignment = {
  booking: BookingConfirmation;
  lot: LotDto;
  added: number;
  pending?: CommandIntent;
};

export function useBookingLotAssignment(api:ScopedApi,booking:BookingConfirmation|undefined,destination:string,disabled:boolean) {
  const source=useMemo(()=>lots(api),[api]);
  const [selected,setSelected]=useState<LotDto|null>(null);
  const selection=selected?.destination_key===destination?selected:null;
  const [phase,setPhase]=useState<'idle'|'saving'|'uncertain'|'stopped'|'done'>('idle');
  const [progress,setProgress]=useState(0);
  const active=useRef(false);
  const assignment=useRef<Assignment|null>(null);
  const page=usePagedResource(JSON.stringify([destination,!!booking]),(cursor,signal)=>
    destination && !booking ? source.list({state:'active',destination_key:destination,limit:50,cursor},signal)
      : Promise.resolve({items:[],page:{has_more:false,next_cursor:null}}));

  const assign=useCallback(async(job:Assignment)=>{
    if(active.current)return;
    active.current=true;
    setPhase('saving');
    try {
      while(job.added<job.booking.parcels.length) {
        if(api.scope.signal.aborted)return;
        const parcel=job.booking.parcels[job.added];
        job.pending??=source.intent({kind:'add',lotId:job.lot.id,body:{parcel_id:parcel.id,expected_version:job.lot.version}});
        const result=await source.execute(job.pending);
        if(!('lots' in result)||result.membership?.parcel_id!==parcel.id)throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol',dispatched:true});
        const updated=result.lots.find(lot=>lot.id===job.lot.id);
        if(!updated)throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol',dispatched:true});
        job.lot=updated;
        job.added++;
        job.pending=undefined;
        setProgress(job.added);
      }
      setPhase('done');
    } catch(error) {
      if(api.scope.signal.aborted)return;
      const recovery=error instanceof ApiFailure?recoveryFor(error,true):'uncertain';
      setPhase(['uncertain','pending'].includes(recovery)?'uncertain':'stopped');
    } finally {active.current=false;}
  },[api,source]);

  useEffect(()=>{
    if(!booking||!selection||assignment.current)return;
    const job={booking,lot:selection,added:0};
    assignment.current=job;
    void assign(job);
  },[assign,booking,selection]);

  const reset=()=>{assignment.current=null;setSelected(null);setProgress(0);setPhase('idle');};
  const picker=!booking ? <div>
      <SelectField label="Add to lot" disabled={disabled||!destination} value={selection?.id??''} options={[
        {value:'',label:destination?'None':'Choose destination first'},...page.items.map(lot=>({value:lot.id,label:lot.code+' · '+lot.name}))
      ]} onChange={id=>setSelected(page.items.find(lot=>lot.id===id)??null)}/>
      {page.phase==='loading'&&<small role="status">Loading lots…</small>}
      {page.phase==='empty'&&destination&&<small>No active lots for this destination.</small>}
      {page.phase==='error'&&<button type="button" className="btn btn-text" onClick={page.reload}>Retry loading lots</button>}
      {page.page.has_more&&<button type="button" className="btn btn-text" disabled={page.phase==='more'} onClick={page.loadMore}>More lots</button>}
  </div>:null;
  const job=assignment.current;
  const result=booking&&job?<section aria-label="Lot assignment">
    <p role="status">{phase==='done'?'Added to '+job.lot.name+'.':phase==='saving'?'Adding parcels to '+job.lot.name+'…':
      phase==='uncertain'?'Booking saved. The last lot assignment is unconfirmed.':'Booking saved. Lot assignment stopped. Check the lot before adding the remaining parcels.'}
      {' '}{progress} of {booking.parcels.length} parcels confirmed.</p>
    {phase==='uncertain'&&<button type="button" className="btn btn-outlined" onClick={()=>void assign(job)}>Retry same lot assignment</button>}
    {phase==='stopped'&&<Link to="/business/lots">Open lots</Link>}
  </section>:null;
  return {picker,result,busy:phase==='saving'||phase==='uncertain',reset};
}
