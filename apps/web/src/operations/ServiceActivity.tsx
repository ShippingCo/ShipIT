import type {ReactNode} from 'react';
import {formatKolkata} from './format';
import './service-activity.css';

interface Activity {
  id: string | number;
  title: string;
  time: string;
  detail?: ReactNode;
}
export function ServiceActivity({label,items}:{label:string;items:readonly Activity[]}) {
  return <ol className="service-activity" aria-label={label}>
    {items.map(item=><li key={item.id}>
      <div className="service-activity-heading"><strong>{item.title}</strong>
        <time dateTime={item.time}>{formatKolkata(item.time)}</time>
      </div>
      {item.detail&&<div className="service-activity-detail">{item.detail}</div>}
    </li>)}
  </ol>;
}
