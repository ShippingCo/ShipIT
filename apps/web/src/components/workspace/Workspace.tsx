import React from 'react';

export function PageHeader({title,description,eyebrow,actions,id='workspace-title'}:{
  title:React.ReactNode;description?:React.ReactNode;eyebrow?:string;actions?:React.ReactNode;id?:string;
}){
  return <div className="workspace-page-header"><div className="workspace-page-heading">
    {eyebrow&&<p className="workspace-eyebrow">{eyebrow}</p>}
    <h1 id={id} tabIndex={-1}>{title}</h1>
    {description&&<p className="workspace-page-description">{description}</p>}
  </div>{actions&&<div className="workspace-header-actions">{actions}</div>}</div>;
}

export function SectionHeader({title,description,actions,level=2}:{
  title:React.ReactNode;description?:React.ReactNode;actions?:React.ReactNode;level?:2|3;
}){
  const Heading=level===3?'h3':'h2';
  return <div className="workspace-section-header"><div><Heading>{title}</Heading>
    {description&&<p className="ops-note">{description}</p>}</div>{actions&&<div className="ops-actions">{actions}</div>}</div>;
}

export interface RecordColumn<Row>{
  key:string;label:React.ReactNode;cell:(row:Row)=>React.ReactNode;
  align?:'left'|'right';className?:string;
}

/** Presentational server worklist. Pagination, ordering and financial totals belong to its producer. */
export function RecordTable<Row>({label,columns,rows,rowKey,caption,empty,selectedKey}:{
  label:string;columns:readonly RecordColumn<Row>[];rows:readonly Row[];rowKey:(row:Row)=>React.Key;
  caption?:React.ReactNode;empty?:React.ReactNode;selectedKey?:React.Key|null;
}){
  return <div className="record-table-region" role="region" aria-label={`${label} table`} tabIndex={0}>
    <table className="ops-table record-table">
      <caption className={caption?'record-table-caption':'workspace-visually-hidden'}>{caption??label}</caption>
      <thead><tr>{columns.map(column=><th key={column.key} scope="col" className={`${column.align==='right'?'record-numeric ':''}${column.className??''}`}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.length?rows.map(row=><tr key={rowKey(row)} data-selected={selectedKey!=null&&rowKey(row)===selectedKey||undefined}>
        {columns.map(column=><td key={column.key} className={`${column.align==='right'?'record-numeric ':''}${column.className??''}`}>{column.cell(row)}</td>)}
      </tr>):<tr><td colSpan={columns.length} className="record-table-empty">{empty??'No records on this page.'}</td></tr>}</tbody>
    </table>
  </div>;
}

export function FilterBar({children,label='Filters',className=''}:{children:React.ReactNode;label?:string;className?:string}){
  return <div className={`workspace-filterbar ${className}`} role="group" aria-label={label}>{children}</div>;
}

export function StatusBadge({children,tone='neutral'}:{children:React.ReactNode;tone?:'neutral'|'info'|'success'|'warning'|'danger'}){
  return <span className={`workspace-status workspace-status-${tone}`}>{children}</span>;
}

/** Keep the current view visible without moving the page or stealing focus. */
export function ActiveViewStrip({children,label,value,className,role='navigation'}:{children:React.ReactNode;label:string;value:string;className:string;role?:'navigation'|'group'}){
  const region=React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(()=>{
    const strip=region.current;if(!strip)return;
    const reveal=()=>{
      const active=strip.querySelector('[aria-pressed="true"]');if(!active)return;
      const bounds=strip.getBoundingClientRect(),selected=active.getBoundingClientRect();
      if(selected.left<bounds.left)strip.scrollLeft+=selected.left-bounds.left;
      else if(selected.right>bounds.right)strip.scrollLeft+=selected.right-bounds.right;
    };
    reveal();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(reveal);observer.observe(strip);return()=>observer.disconnect();
  },[value]);
  return <div ref={region} className={className} role={role} aria-label={label}>{children}</div>;
}

/** Button group rather than incomplete ARIA tabs: existing workflows retain their mounted-state rules. */
export function WorkflowTabs({items,value,onChange,label='Views'}:{
  items:readonly {value:string;label:React.ReactNode;disabled?:boolean}[];value:string;onChange:(value:string)=>void;label?:string;
}){
  return <ActiveViewStrip className="workspace-view-switch" role="group" label={label} value={value}>
    {items.map(item=><button key={item.value} type="button" aria-pressed={value===item.value} disabled={item.disabled} onClick={()=>onChange(item.value)}>{item.label}</button>)}
  </ActiveViewStrip>;
}
