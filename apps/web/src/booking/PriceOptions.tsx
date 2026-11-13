import {Msym} from '../components/m3/Icon';
import {receiptMoney} from '../utils/receipt-view';
import type {BookingServiceOption} from '../data-access/booking-services';

/**
 * The price, as a choice the operator can read out loud.
 *
 * The counter used to price from a single rate card with a dropdown of service names and no
 * amounts, so the one question a customer actually asks — "what are my options?" — could only
 * be answered by picking each one in turn and watching the total change. The operator was
 * doing arithmetic in front of the customer, and the customer was watching them do it.
 *
 * Each card now carries the amount and, next to it, the difference from the option this shop
 * sells most. The difference is the sentence: "express is forty rupees more". Nothing is
 * selected until the operator selects it, because a pre-selected tier is a tier that gets sold
 * by accident.
 *
 * Arrival dates are not here. The rate card has no transit time in it — not for this branch,
 * not for any — and a date invented at the counter is a promise the shop has to keep. The
 * screen says that plainly instead, in the same register the product uses elsewhere when a
 * thing is not configured. See the PRD's Q4.
 */

export interface PriceOption {
  /** The value written to the draft: a service key, or 'option:<id>' for a named account rate. */
  key: string;
  name: string;
  /** Freight plus packing, before tax, in paise. Null when this branch publishes no rate for it. */
  paise: number | null;
  /** A rate agreed with this customer's account rather than the shop's published card. */
  negotiated?: boolean;
}

const serviceNames: Record<string,string> = { standard: 'Standard', express: 'Express', same_city: 'Same-city' };
export const serviceName = (key:string) => serviceNames[key] ?? key.replaceAll('_',' ');

/** What this branch charges for one service at this weight, from the card already on screen. */
export function ruleAmount(rules:readonly {destination_key:string;service:string;min_weight_grams:number;max_weight_grams:number|null;freight_paise:number;packing_paise:number}[],
  destination:string, service:string, grams:number):number|null {
  const matches=rules.filter(rule=>rule.destination_key===destination&&rule.service===service
    &&grams>=rule.min_weight_grams&&(rule.max_weight_grams===null||grams<rule.max_weight_grams));
  // Two rules covering one weight is a published conflict. The server refuses to quote it, so
  // the counter must not show a figure for it either.
  return matches.length===1?matches[0]!.freight_paise+matches[0]!.packing_paise:null;
}

/** What a named service option costs at this weight. Mirrors the server's own flat/per-kg rule. */
export function optionAmount(option:BookingServiceOption, grams:number):number|null {
  const {kind,first_kg_paise,additional_kg_paise,packing_paise}=option.pricing;
  if(kind==='flat')return first_kg_paise+packing_paise;
  const extraKg=grams>1000?Math.ceil((grams-1000)/1000):0;
  return first_kg_paise+extraKg*additional_kg_paise+packing_paise;
}

export function PriceOptions({options,value,recommended,weighed,disabled,onChange,setupHref}:{
  options:readonly PriceOption[];
  value:string;
  /** The option this shop sells most. Marked, never chosen on the operator's behalf. */
  recommended:string;
  /** False until every parcel has a weight: an amount without a weight behind it is a guess. */
  weighed:boolean;
  disabled:boolean;
  onChange:(key:string)=>void;
  setupHref:string;
}) {
  const base=options.find(option=>option.key===recommended)?.paise ?? null;
  return <div className="price-options">
    <p className="price-options-head" id="price-options-head">Price options
      <span>{weighed?'Read the difference to the customer. Nothing is chosen until you choose it.':'Enter the weight to see what each service costs.'}</span></p>
    <div className="price-option-list" role="radiogroup" aria-labelledby="price-options-head">
      {options.map(option=>{
        const selected=value===option.key;
        const gap=weighed&&base!==null&&option.paise!==null&&option.key!==recommended?option.paise-base:null;
        return <button key={option.key} type="button" role="radio" aria-checked={selected} disabled={disabled||option.paise===null}
          tabIndex={selected||(!options.some(o=>o.key===value)&&option===options[0])?undefined:-1}
          className={'price-option'+(selected?' is-on':'')+(option.negotiated?' is-negotiated':'')}
          onClick={()=>onChange(option.key)}>
          <span className="po-mark" aria-hidden="true"><Msym name={selected?'radio_button_checked':'radio_button_unchecked'}/></span>
          <span className="po-body">
            <span className="po-name">{option.name}
              {option.negotiated&&<em className="po-tag po-tag-account">Your agreed rate</em>}
              {!option.negotiated&&option.key===recommended&&<em className="po-tag">Most used</em>}</span>
            <span className="po-diff">{
              !weighed?'Needs a weight'
              :option.paise===null?'No published rate for this weight'
              :gap===null?'What the others are compared against'
              :gap===0?'Same price'
              :receiptMoney(Math.abs(gap))+(gap>0?' more':' less')}</span>
          </span>
          <span className="po-amount">{weighed&&option.paise!==null?receiptMoney(option.paise):'—'}</span>
        </button>;
      })}
    </div>
    <div className="price-options-foot">
      <p><Msym name="schedule"/><span>Delivery times are not set up for this branch, so no arrival date can be promised.</span></p>
      <a className="po-setup" href={setupHref} target="_blank" rel="noopener noreferrer">Open booking setup · new tab</a>
    </div>
  </div>;
}
