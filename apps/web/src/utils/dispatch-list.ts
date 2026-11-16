/**
 * The sheet that travels with the vehicle.
 *
 * This is a custody handover, not a packing slip. A driver takes a sack of other people's
 * parcels and other people's money, and the only record that the shop gave them to that driver
 * on that day is this piece of paper, signed twice.
 *
 * Two pages, in that order and for a reason.
 *
 *   Page one is **bags**. At the yard the operator counts sacks into a vehicle, so page one is
 *   a list a person can count against: six lines, not a hundred and twenty dockets.
 *   Page two is every docket. Nobody reads it at loading time. It exists for the day somebody
 *   says a parcel never arrived, and then it is the only thing that settles it.
 *
 * One renderer builds both the screen and the paper, exactly as the receipt does, so the sheet
 * an operator checks and the sheet that comes out of the printer cannot drift apart.
 */

export interface DispatchBagLine { city:string; code:string; parcels:number; weight:string }
export interface DispatchParcelLine { docket:string; city:string; weight:string; bag:string }

export interface DispatchListView {
  /** The vehicle. The first thing on the page, because it is what the yard matches on. */
  vehicle:string;
  shop:string;
  from:string;
  to:string;
  leaves:string;
  /** The trip's own reference, for a dispute. Never the thing anyone looks for. */
  reference:string;
  bags:readonly DispatchBagLine[];
  parcels:readonly DispatchParcelLine[];
  totals:{bags:number;parcels:number;weight:string};
  /** Set on every print after the first, carrying the time of this reprint. */
  duplicate?:string;
  /** Printed before sealing: the list can still change, and the paper has to admit it. */
  provisional?:boolean;
}

const escape=(value:string)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

const sheet='font-family:Roboto,sans-serif;font-variant-numeric:tabular-nums;max-width:760px;margin:0 auto;color:#17212b';
const th='text-align:left;font-size:13px;padding:6px 8px;border-bottom:2px solid #17212b';
const td='font-size:14px;padding:7px 8px;border-bottom:1px solid #dde5ef';

/** All variable content is escaped in text context; there are no dynamic URLs or attributes. */
export function renderDispatchList(view:DispatchListView):string {
  const mark=(label:string,colour:string)=>`<span style="border:2px solid ${colour};color:${colour};border-radius:6px;padding:4px 10px;font-weight:700;letter-spacing:0.08em">${label}</span>`;
  const marks=[
    view.provisional?mark('NOT SEALED','#b3261e'):'',
    view.duplicate?mark('DUPLICATE','#17212b')+`<span style="align-self:center;font-size:13px;color:#5a6b7b">Reprinted ${escape(view.duplicate)}</span>`:'',
  ].filter(Boolean).join('');
  return `<div class="dispatch-sheet" style="${sheet}">
    <header style="display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:2px solid #17212b;padding-bottom:14px;margin-bottom:14px;overflow-wrap:anywhere">
      <div>
        <div style="font-size:13px;color:#5a6b7b;letter-spacing:0.06em">DISPATCH LIST</div>
        <div style="font-size:27px;font-weight:700;line-height:1.1">${escape(view.vehicle)}</div>
        <div style="font-size:15px">${escape(view.from)} → ${escape(view.to)} · leaves ${escape(view.leaves)}</div>
      </div>
      <div style="text-align:right;font-size:13px;color:#5a6b7b">
        <div>${escape(view.shop)}</div><div>${escape(view.reference)}</div>
      </div>
    </header>
    ${marks?`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${marks}</div>`:''}

    <div style="display:flex;gap:28px;flex-wrap:wrap;margin-bottom:14px;font-size:15px">
      <div><b style="font-size:21px">${view.totals.bags}</b> bags</div>
      <div><b style="font-size:21px">${view.totals.parcels}</b> parcels</div>
      <div><b style="font-size:21px">${escape(view.totals.weight)}</b> kg</div>
    </div>

    <h2 style="font-size:17px;margin:0 0 6px">Bags on this vehicle</h2>
    ${view.bags.length?`<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <thead><tr><th style="${th}">City</th><th style="${th}">Bag</th><th style="${th};text-align:right">Parcels</th><th style="${th};text-align:right">kg</th></tr></thead>
      <tbody>${view.bags.map(bag=>`<tr><td style="${td}"><b>${escape(bag.city)}</b></td><td style="${td};font-family:ui-monospace,Consolas,monospace">${escape(bag.code)}</td><td style="${td};text-align:right">${bag.parcels}</td><td style="${td};text-align:right">${escape(bag.weight)}</td></tr>`).join('')}</tbody>
    </table>`:`<p style="font-size:15px;color:#5a6b7b;margin:0 0 18px">No bags on this vehicle. The parcels below were loaded one by one.</p>`}

    <div style="display:flex;gap:40px;margin-top:26px;page-break-inside:avoid">
      <div style="flex:1">
        <div style="border-bottom:1px solid #17212b;height:46px"></div>
        <div style="font-size:13px;color:#5a6b7b;padding-top:4px">Handed over by (shop) — name and signature</div>
      </div>
      <div style="flex:1">
        <div style="border-bottom:1px solid #17212b;height:46px"></div>
        <div style="font-size:13px;color:#5a6b7b;padding-top:4px">Received by (driver) — name and signature</div>
      </div>
    </div>

    <div style="page-break-before:always;padding-top:18px">
      <h2 style="font-size:17px;margin:0 0 4px">Every parcel on this vehicle</h2>
      <p style="font-size:13px;color:#5a6b7b;margin:0 0 8px">Page two is for a dispute. Nothing here needs checking at loading time.</p>
      ${view.parcels.length?`<table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th}">Docket</th><th style="${th}">To</th><th style="${th}">In bag</th><th style="${th};text-align:right">kg</th></tr></thead>
        <tbody>${view.parcels.map(parcel=>`<tr><td style="${td};font-family:ui-monospace,Consolas,monospace"><b>${escape(parcel.docket)}</b></td><td style="${td}">${escape(parcel.city)}</td><td style="${td};font-family:ui-monospace,Consolas,monospace">${escape(parcel.bag)}</td><td style="${td};text-align:right">${escape(parcel.weight)}</td></tr>`).join('')}</tbody>
      </table>`:`<p style="font-size:15px;color:#5a6b7b">No parcels are loaded on this vehicle yet.</p>`}
    </div>
  </div>`;
}

/** Called only by an explicit user action. Print completion is never a domain fact. */
export function printDispatchList(view:DispatchListView):void {
  document.getElementById('print-root')?.remove();
  const root=document.createElement('div');
  root.id='print-root';
  root.innerHTML=renderDispatchList(view);
  document.body.appendChild(root);
  document.body.classList.add('printing');
  try{window.print();}finally{document.body.classList.remove('printing');root.remove();}
}
