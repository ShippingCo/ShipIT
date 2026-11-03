import type {ReactNode} from 'react';

export function ReportMeasures({label,items}:{label:string;items:readonly {label:string;value:ReactNode}[]}) {
  return <dl className="report-measure-band" aria-label={label}>
    {items.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
  </dl>;
}
