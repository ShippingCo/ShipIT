import React from 'react';
import {IconTile} from '../m3/Controls';
import {Msym} from '../m3/Icon';
import './service-reference.css';

export function ReportCard({title,description,icon,metric,detail,selected,disabled,onClick}:{title:string;description:string;icon:string;metric?:React.ReactNode;detail?:React.ReactNode;selected?:boolean;disabled?:boolean;onClick:()=>void}) {
 return <button type="button" className="repcard" aria-pressed={selected} disabled={disabled} onClick={onClick}><IconTile name={icon} size="lg"/>{metric!==undefined&&<span className="repcard-v">{metric}</span>}{detail&&<span className="repcard-l">{detail}</span>}<span className="repcard-t">{title}</span><span className="repcard-d">{description}</span><span className="repcard-go">{selected?'Selected':'Open'}<Msym name="arrow_forward"/></span></button>;
}

export function MessageFeedRow({title,status,time,children,action}:{title:string;status:React.ReactNode;time:React.ReactNode;children:React.ReactNode;action:React.ReactNode}) {
 return <li className="reference-message-row"><Msym name="smart_toy" size={20}/><div className="reference-message-main"><div className="reference-message-title"><strong>{title}</strong>{status}</div><div className="ops-note">{time}</div><div className="reference-message-evidence">{children}</div></div><div className="reference-message-action">{action}</div></li>;
}
