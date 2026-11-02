import React from 'react';
import {Dialog} from '../m3/Dialog';
import './dispatch-cards.css';

/** Keep uncertain commands mounted so a dialog cannot discard its retry identity. */
export function OperationDialog({open=true,title,busy=false,close,children,initialFocusId}:{open?:boolean;title:string;busy?:boolean;close:()=>void;children:React.ReactNode;initialFocusId?:string}) {
 return <Dialog initialFocusId={initialFocusId} open={open} size="lg" title={title} hideClose={busy} onClose={()=>{if(!busy)close();}}><div className="operation-dialog-body">{children}</div>{busy&&<p role="status" className="ops-note">Keep this window open until the action is confirmed. If the result is uncertain, retry the same request.</p>}</Dialog>;
}
