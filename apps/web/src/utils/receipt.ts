import { findByDocket, db, fmtMoney, fmtDT, esc, grossOf } from '../data/store';

function initials(name) {
  return esc((name || 'S').trim().charAt(0).toUpperCase());
}

export function receiptHTML(b, biz) {
  const total = grossOf(b);
  const eta = fmtDT(Date.now() + b.etaDays * 864e5);
  const pct = (v) => `${+(v * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const t = b.tax;
  const taxRows = t && t.rate > 0 ? (b.supply === 'inter' ? [
    ['Taxable value', fmtMoney(t.taxable)],
    [`IGST ${pct(t.rate)}`, fmtMoney(t.igst)],
  ] : [
    ['Taxable value', fmtMoney(t.taxable)],
    [`CGST ${pct(t.rate / 2)}`, fmtMoney(t.cgst)],
    [`SGST ${pct(t.rate / 2)}`, fmtMoney(t.sgst)],
  ]) : [];
  return `
  <div class="receipt-sheet" style="font-family:'Roboto',sans-serif">
    <div style="display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #17212b;padding-bottom:14px;margin-bottom:16px">
      <div style="display:flex;gap:12px;align-items:center">
        <div style="width:52px;height:52px;border-radius:12px;background:#0b57d0;color:#fff;font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none">
          ${biz.logo ? `<img src="${esc(biz.logo)}" style="width:100%;height:100%;object-fit:cover">` : initials(biz.name)}
        </div>
        <div>
          <div style="font-size:19px;font-weight:700">${esc(biz.name)}</div>
          <div style="font-size:12px;color:#5a6b7b">${esc(biz.address)}</div>
          <div style="font-size:12px;color:#5a6b7b">${esc(biz.phone)}${biz.gstin ? ' • GSTIN: ' + esc(biz.gstin) : ''}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.12em;color:#5a6b7b">${t && t.rate > 0 ? 'Tax Invoice' : 'Courier Receipt'}</div>
        <div class="mono" style="font-size:19px;font-weight:700;letter-spacing:.04em">${esc(b.docket)}</div>
        <div style="height:32px;margin-top:6px;background:repeating-linear-gradient(90deg,#17212b 0 2px,transparent 2px 4px,#17212b 4px 5px,transparent 5px 9px)"></div>
        <div style="font-size:10.5px;letter-spacing:.3em;margin-top:3px;color:#5a6b7b">${esc(b.docket)}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div style="background:#f5f8fd;border:1px solid #dde5ef;border-radius:10px;padding:12px 14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#7a8b99;margin-bottom:5px">From</div>
        <div style="font-weight:600">${esc(biz.name)}</div>
        <div style="font-size:12px;color:#5a6b7b">${esc(biz.address)}</div>
      </div>
      <div style="background:#f5f8fd;border:1px solid #dde5ef;border-radius:10px;padding:12px 14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#7a8b99;margin-bottom:5px">To</div>
        <div style="font-weight:600">${esc(b.name)} · ${esc(b.phone)}</div>
        <div style="font-size:12px;color:#5a6b7b">${esc(b.address || '')} ${esc(b.to)}</div>
      </div>
    </div>

    ${[
      ['Booking date', fmtDT(b.createdAt)],
      ['Service / Weight', `${esc(b.serviceType)} · ${esc(b.weightKg)} kg`],
      ['Estimated delivery', `${esc(eta)} (~${esc(b.etaDays)} day${b.etaDays > 1 ? 's' : ''})`],
      ['Packing charges', fmtMoney(b.amount.packing)],
      ['Freight charges', fmtMoney(b.amount.freight)],
      ...taxRows,
    ].map(([k, v]) => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #dde5ef;font-size:13px">
        <span>${k}</span><b>${v}</b>
      </div>`).join('')}

    <div style="display:flex;justify-content:space-between;background:#0b57d0;color:#fff;border-radius:10px;padding:12px 14px;margin-top:12px;font-weight:700;font-size:15px">
      <span>Total paid</span><span>${fmtMoney(total)}</span>
    </div>

    <div style="margin-top:16px;padding-top:12px;border-top:1px dashed #c9d4de;font-size:11px;color:#5a6b7b;display:flex;justify-content:space-between;gap:14px">
      <div>Track 24×7 on WhatsApp — just send your docket number to our bot.<br/>Prohibited goods not accepted. Liability as per carrier terms.</div>
      <div style="align-self:flex-end;text-align:right">For ${esc(biz.name)}<br/><br/>Authorised Signatory</div>
    </div>
  </div>`;
}

export function printReceipt(docket) {
  const b = findByDocket(docket);
  if (!b) return;
  let pr = document.getElementById('print-root');
  if (!pr) {
    pr = document.createElement('div');
    pr.id = 'print-root';
    document.body.appendChild(pr);
  }
  pr.innerHTML = `<div style="max-width:660px;margin:0 auto">${receiptHTML(b, db().business)}</div>`;
  document.body.classList.add('printing');
  window.print();
  setTimeout(() => document.body.classList.remove('printing'), 1200);
}
