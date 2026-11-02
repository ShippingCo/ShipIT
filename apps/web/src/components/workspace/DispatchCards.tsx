import React from 'react';
import {Card} from '../m3/Surface';
import {Msym} from '../m3/Icon';
import './dispatch-cards.css';

/** Shared reference presentation. Adapters supply facts and authorized actions. */
export function LotCardView({name,code,adornment,route,warning=false,children,actions}:{name:string;code:string;adornment?:React.ReactNode;route?:React.ReactNode;warning?:boolean;children:React.ReactNode;actions:React.ReactNode}) {
 return <Card className="lot reference-dispatch-card"><div className="lot-head"><span className="reference-dispatch-icon"><Msym name="layers" size={28}/></span><div className="u-grow reference-dispatch-heading"><div className="lot-name">{name}</div><div className="lot-code mono">{code}</div></div>{adornment}</div>
  {route&&<div className={`lot-route${warning?' is-warn':''}`}><Msym name={warning?'error_outline':'pin_drop'}/>{route}</div>}
  <div className="lot-body">{children}</div><div className="lot-actions">{actions}</div>
 </Card>;
}
export function RouteCardView({icon,title,meta,status,children}:{icon:string;title:string;meta:React.ReactNode;status:React.ReactNode;children:React.ReactNode}) {
 return <Card className="reference-dispatch-card"><div className="rt"><div className="rt-head"><Msym name={icon} className="rt-mode"/><div className="u-grow reference-dispatch-heading"><div className="rt-title">{title}</div><div className="rt-meta">{meta}</div></div>{status}</div>{children}</div></Card>;
}
