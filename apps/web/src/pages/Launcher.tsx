import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Msym } from '../components/m3/Icon';
import { useToast } from '../components/m3/Snackbar';
import { ConfirmDialog } from '../components/m3/Dialog';
import { resetDemo } from '../data/store';

export default function Launcher() {
  const toast = useToast();
  const [resetAsk, setResetAsk] = useState(false);
  return (
    <div className="launch-hero">
      <div className="launch-logo"><Msym name="local_shipping" /></div>
      <h1 className="t-display-md" style={{ marginTop: 20, textAlign: 'center' }}>
        ShippingCo
      </h1>
      <p className="t-body-lg muted" style={{ maxWidth: 560, textAlign: 'center', marginTop: 10 }}>
        A customer-connection layer for India's SMB courier shops. Book parcels, print receipts,
        group them into lots &amp; routes — and let the AI assistant keep every customer updated on WhatsApp.
      </p>

      <div className="launch-cards">
        <Link to="/business" className="card card-hover" style={{ padding: 26, textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="kpi-icon ic-accent" style={{ width: 48, height: 48, borderRadius: 14, marginBottom: 14 }}>
            <Msym name="storefront" style={{ fontSize: 24 }} />
          </div>
          <div className="t-title-md">Business Console</div>
          <p className="t-body-md muted" style={{ margin: '6px 0 12px' }}>
            New bookings with printable receipts · package tracking · lots &amp; dispatch routes ·
            one-click delay alerts to every affected customer.
          </p>
          <span className="t-label-lg" style={{ color: 'var(--md-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Open console <Msym name="arrow_forward" style={{ fontSize: 16 }} />
          </span>
        </Link>

        <Link to="/customer" className="card card-hover" style={{ padding: 26, textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="kpi-icon ic-accent" style={{ width: 48, height: 48, borderRadius: 14, marginBottom: 14 }}>
            <Msym name="forum" style={{ fontSize: 24 }} />
          </div>
          <div className="t-title-md">Customer WhatsApp</div>
          <p className="t-body-md muted" style={{ margin: '6px 0 12px' }}>
            The AI bot every customer talks to — track parcels, delivery ETAs, delay alerts,
            charges and delivery OTPs. Zero phone calls.
          </p>
          <span className="t-label-lg" style={{ color: 'var(--md-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Open WhatsApp view <Msym name="arrow_forward" style={{ fontSize: 16 }} />
          </span>
        </Link>
      </div>

      <div className="feature-strip">
        <span className="chip chip-tonal"><Msym name="bolt" />Instant docket on WhatsApp</span>
        <span className="chip chip-tonal"><Msym name="flight_takeoff" />Route-level delay alerts</span>
        <span className="chip chip-tonal"><Msym name="layers" />Lot broadcasts</span>
        <span className="chip chip-tonal"><Msym name="password" />OTP-safe delivery</span>
      </div>

      <button className="btn btn-text btn-sm" style={{ marginTop: 10 }} onClick={() => setResetAsk(true)}>
        Reset demo data
      </button>

      <ConfirmDialog
        open={resetAsk}
        onClose={() => setResetAsk(false)}
        danger
        title="Reset demo data?"
        body="This clears all bookings, chats and routes in this browser and restores the sample shop."
        confirmLabel="Reset"
        onConfirm={() => { resetDemo(); toast('Demo data restored.'); }}
      />
    </div>
  );
}
