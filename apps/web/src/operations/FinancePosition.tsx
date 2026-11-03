type Amount = {label:string; value:string; note?:string};

/** The source supplies already-formatted amounts so large ledger values retain their precision. */
export function FinancePosition({label,primary,items}:{label:string;primary:Amount;items:Amount[]}) {
 return <dl className="finance-position" aria-label={label}>
  {[primary,...items].map(item=><div key={item.label}>
   <dt>{item.label}</dt><dd>{item.value}{item.note&&<small>{item.note}</small>}</dd>
  </div>)}
 </dl>;
}
