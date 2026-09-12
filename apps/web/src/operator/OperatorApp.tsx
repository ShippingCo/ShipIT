import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TextField } from '../components/m3/Input';
import BusinessShell from '../pages/business/BusinessShell';
import SignIn from './SignIn';
import Onboarding, { clearPending } from './Onboarding';
import { request } from './api';
import { createScopeController } from './scope';
import './operator.css';

export default function OperatorApp() {
  const [controller] = useState(createScopeController);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const location = useLocation(), navigate = useNavigate();
  const selected = useRef<string | undefined>(undefined);
  const [invitation, setInvitation] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const refresh = () => controller.load(selected.current, location.pathname);
  useEffect(() => {
    void controller.load(selected.current, location.pathname);
    const resume = () => { if (document.visibilityState === 'visible') void controller.load(selected.current, location.pathname); };
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); controller.clear(); };
  }, [controller, location.pathname]);
  useEffect(() => {
    if (state.context?.state === 'ready') {
      selected.current = state.context.active_franchise_id ?? undefined;
      clearPending(state.context.user_id);
      document.getElementById('workspace-title')?.focus();
    }
  }, [state.context]);
  async function accept(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage('');
    const token = invitation; setInvitation(''); controller.clear();
    try {
      await request('/api/v1/membership-invitations/accept', { body: { token } });
      selected.current = undefined; await refresh();
      setMessage('Invitation accepted. Your permitted workspace has been refreshed.');
    } catch {
      await refresh(); setMessage('Invitation could not be confirmed. Refresh workspace access; otherwise ask the sender for a new invitation for your verified identity.');
    } finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return; setBusy(true); setMessage(''); controller.clear();
    try { await request('/auth/logout', { body: {} }); selected.current = undefined; controller.clear('signed_out', location.pathname); }
    catch { controller.clear('error', location.pathname); setMessage('Sign-out could not be confirmed. Retry when the connection returns.'); }
    finally { setBusy(false); }
  }
  const context = state.context;
  // A changed route never renders data from the previous authorization check, even before effects run.
  const loading = state.status === 'loading' || state.path !== location.pathname;
  return <div className="operator-root">
    {loading ? <main className="operator-center" role="status">Checking workspace access…</main> : state.status === 'signed_out' ?
      <main className="operator-center"><SignIn complete={async () => { selected.current = undefined; await refresh(); }} /></main> :
      state.status === 'error' ? <main className="operator-center"><section className="card operator-card">
        <h1 className="t-headline-sm">Workspace access unavailable</h1>
        <p role="alert">Your session or access may have changed, or the service is unavailable. Private workspace data has been cleared.</p>
        <button className="btn btn-filled" disabled={busy} onClick={() => { selected.current = undefined; void refresh(); }}>Refresh workspace access</button>
      </section></main> : context?.state === 'ready' ? <BusinessShell context={context} select={id => {
        selected.current = id; void controller.load(id, location.pathname);
      }} /> : <main className="operator-center">
        {context?.state === 'onboarding_required' ? <Onboarding userId={context.user_id} complete={async () => { await refresh(); navigate('/business'); }} /> :
          <section className="card operator-card"><h1 className="t-headline-sm">No available workspace</h1><p role="alert">Ask an administrator to restore access or send an invitation. Disabled locations and revoked memberships cannot be used.</p></section>}
      </main>}
    {!loading && state.status !== 'signed_out' && <footer className="operator-actions">
      <button className="btn btn-text" disabled={busy} onClick={() => { selected.current = undefined; void refresh(); }}>Refresh workspace access</button>
      <button className="btn btn-text" disabled={busy} onClick={() => { void logout(); }}>Sign out</button>
      {context && <form onSubmit={event => { void accept(event); }} className="operator-invitation">
        <TextField label="Invitation code" type="password" value={invitation} onChange={setInvitation} autoComplete="off" required disabled={busy} />
        <button className="btn btn-outlined" disabled={busy || !invitation}>Accept invitation</button>
      </form>}
    </footer>}
    {message && <p className="operator-message" role="status">{message}</p>}
  </div>;
}
