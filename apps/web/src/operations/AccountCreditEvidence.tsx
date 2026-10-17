import {useState} from 'react';
import type {customerAccounts} from '../data-access/customer-accounts';
import {usePagedResource} from './hooks';
import {formatMoney,formatKolkata} from './format';
export function AccountCreditEvidence({source,account,cutoff}:{source:ReturnType<typeof customerAccounts>;account:string;cutoff:string}) {
 const [expanded,setExpanded]=useState(false);
 return <div className="account-credit-evidence"><button type="button" className="btn btn-text" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>Credit source bookings</button>{expanded&&<Sources key={account+cutoff} source={source} account={account} cutoff={cutoff}/>}</div>;
}
function Sources({source,account,cutoff}:{source:ReturnType<typeof customerAccounts>;account:string;cutoff:string}) {
 const rows=usePagedResource(account+cutoff,(cursor,signal)=>source.sources(account,cutoff,cursor??undefined,signal).then(p=>({items:p.items,page:{has_more:!!p.next_cursor,next_cursor:p.next_cursor}})));
 return <div><p>Source cutoff: {formatKolkata(cutoff)}. Outstanding is original charge minus reductions and net collections, plus net refunds, floored at zero per booking. Unallocated advances do not reduce it.</p>
 {rows.phase==='loading'?<p role="status">Loading source evidence…</p>:rows.phase==='error'?<><p role="alert">Source evidence unavailable.</p><button type="button" onClick={rows.reload}>Retry credit sources</button></>:!rows.items.length?<p>No account bookings at this cutoff.</p>:<ul className="ops-list">{rows.items.map(r=><li key={r.booking_id}><p>Booking reference <code>{r.booking_id}</code> · Due {r.due_date}</p><p>Original {formatMoney(r.gross_paise)} − Reductions {formatMoney(r.reduction_paise)} − Net collections {formatMoney(r.collected_paise)} + Net refunds {formatMoney(r.refund_paise)} = Outstanding {formatMoney(r.outstanding_paise)}</p></li>)}</ul>}
 {rows.page.has_more&&<button type="button" className="btn btn-text" disabled={rows.phase==='more'} onClick={rows.loadMore}>More credit sources</button>}</div>;
}
