import React,{useEffect,useRef,useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {Msym} from '../m3/Icon';
import {consoleAreas,consoleSections,type ConsoleLink} from './console-navigation';
import './console-frame.css';

export function ConsoleNavigation({links,area,onNavigate}:{links:readonly ConsoleLink[];area:string;onNavigate:()=>void}) {
  const create=links.find(link=>link.area==='booking');
  const render=(link:ConsoleLink)=><Link key={link.area} to={link.to} onClick={onNavigate}
    aria-current={area===link.area?'page':undefined} className={`drawer-item${area===link.area?' active':''}`}>
    <Msym name={link.icon}/><span>{link.label}</span>{link.badge!==undefined&&<span className="count">{link.badge}</span>}</Link>;
  return <nav id="workspace-navigation" className="drawer-section console-navigation" aria-label="Workspace navigation">
    {create&&<Link className="console-create" to={create.to} aria-current={area===create.area?'page':undefined}
      onClick={onNavigate}><Msym name="add"/>{create.label}</Link>}
    {consoleSections(links.filter(link=>link.area!=='booking')).map(section=>
      <div key={section.label} role="group" aria-label={section.label} className="console-task-group">
        <div className="console-group-label">{section.label}</div>{section.links.map(render)}
      </div>)}
  </nav>;
}

/** Shared chrome: no demo store, server client, credentials or permission decisions. */
export function ConsoleFrame({links,area,businessName,subtitle,logo,footer,scopeSelector,onSearch,searchLabel='Search everything',children,className=''}:{
  links:readonly ConsoleLink[];area:string;businessName:string;subtitle:string;logo?:string;
  footer?:React.ReactNode;scopeSelector?:React.ReactNode;onSearch:()=>void;searchLabel?:string;children:React.ReactNode;className?:string;
}) {
  const location=useLocation(),navigate=useNavigate();
  const [open,setOpen]=useState(false),[scrolled,setScrolled]=useState(false);
  const toggle=useRef<HTMLButtonElement>(null),drawer=useRef<HTMLElement>(null);
  const home=area==='workspace',booking=links.find(link=>link.area==='booking');
  useEffect(()=>{setOpen(false);},[location.pathname,location.search]);
  useEffect(()=>{const scroll=()=>setScrolled(window.scrollY>4);scroll();window.addEventListener('scroll',scroll,{passive:true});return()=>window.removeEventListener('scroll',scroll);},[]);
  useEffect(()=>{
    if(!open)return;
    (drawer.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]')??drawer.current?.querySelector<HTMLAnchorElement>('nav a'))?.focus();
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){setOpen(false);toggle.current?.focus();}};
    document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
  },[open]);
  return <div className={`shell console-frame ${className}`}>
    <a className="workspace-skip-link" href="#workspace-content" onClick={event=>{event.preventDefault();document.getElementById('workspace-content')?.focus();}}>Skip to content</a>
    <aside ref={drawer} className={`drawer-pane${open?' open':''}`} onBlur={event=>{if(open&&event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget)&&event.relatedTarget!==toggle.current)setOpen(false);}}>
      <div className="drawer-head"><div className="avatar lg">{logo?<img src={logo} alt=""/>:businessName.charAt(0)}</div><div className="console-brand-text"><div className="t-title-md u-truncate">{businessName}</div><div className="t-body-sm muted u-truncate">{subtitle}</div></div></div>
      {scopeSelector&&<div className="console-scope">{scopeSelector}</div>}
      <ConsoleNavigation links={links} area={area} onNavigate={()=>setOpen(false)}/>
      {footer&&<div className="drawer-foot">{footer}</div>}
    </aside>
    {open&&<div className="console-scrim" aria-hidden="true" onClick={()=>{setOpen(false);toggle.current?.focus();}}/>}
    <div className="main-area">
      <header className={`appbar${scrolled?' scrolled':''}`}>
        <button ref={toggle} type="button" className="iconbtn burger" aria-label={open?'Close workspace navigation':'Open workspace navigation'} aria-controls="workspace-navigation" aria-expanded={open} onBlur={event=>{if(open&&event.relatedTarget instanceof Node&&!drawer.current?.contains(event.relatedTarget))setOpen(false);}} onClick={()=>setOpen(value=>!value)}><Msym name={open?'close':'menu'}/></button>
        {!home&&<button type="button" className="iconbtn" onClick={()=>navigate('/business')} aria-label="Back to dashboard"><Msym name="arrow_back"/></button>}
        <div className="appbar-title u-grow t-title-lg">{links.find(link=>link.area===area)?.label??consoleAreas[area]?.label??'ShippingCo'}</div>
        <button type="button" className="appbar-search" onClick={onSearch} aria-label={searchLabel}><Msym name="search"/><span className="lbl">Search anything…</span><kbd className="searchbar-kbd">Ctrl K</kbd></button>
        {home&&booking&&<Link className="btn btn-filled appbar-cta" to={booking.to}><Msym name="add"/>New Booking</Link>}
      </header>
      {children}
      {home&&booking&&<Link className="fab fab-mobile-only console-booking-fab" to={booking.to}><Msym name="add"/>New Booking</Link>}
    </div>
  </div>;
}
