import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { db, updateStatus, queueMsg, createRoute, postRouteEvent, findByDocket, addBooking, setEwayBill, ewayState, ewayValidDays } from '../data/store';

describe('fresh-browser startup (blank screen regression)', () => {
  it('store seeds itself before first render even with empty localStorage', async () => {
    localStorage.clear();
    vi.resetModules();
    const store = await import('../data/store');
    const snap = store.getSnapshot();
    expect(snap).not.toBeNull();
    expect(Array.isArray(snap.bookings)).toBe(true);
    expect(snap.bookings.length).toBeGreaterThan(0);
    expect(snap.business.name).toBeTruthy();
  });

  it('heals corrupted persisted state', async () => {
    localStorage.setItem('shippingco_v1', '{"bookings":"oops"}');
    vi.resetModules();
    const store = await import('../data/store');
    const snap = store.getSnapshot();
    expect(Array.isArray(snap.bookings)).toBe(true);
    expect(snap.routes.length).toBeGreaterThan(0);
  });
});

// The app bar names the screen you are on. Wait for THAT after a hash change, never for
// a piece of page content: the dashboard now carries dockets and route codes of its own,
// so findByText('SBC104210') resolves against the screen being left and the click that
// follows lands on the wrong page.
const PAGE_TITLE = {
  '/business': 'Dashboard',
  '/business/booking': 'New Booking',
  '/business/packages': 'Packages',
  '/business/lots': 'Lots',
  '/business/routes': 'Dispatch Routes',
  '/business/feed': 'Automation Feed',
  '/business/receipts': 'Receipts',
  '/business/reports': 'Reports',
  '/business/eway': 'E-way Bills',
  '/business/settings': 'Settings',
};

async function goto(hash) {
  window.location.hash = hash;
  const want = PAGE_TITLE[hash.split('?')[0]] || 'ShippingCo';   // the shell falls back the same way
  await waitFor(() => expect(document.querySelector('.appbar-title')?.textContent).toBe(want));
}

async function goBusiness() {
  await goto('/business');
  return screen.findByText('Parcels moving');
}

describe('Launcher', () => {
  it('renders both entry cards', async () => {
    render(<App />);
    expect(await screen.findByText('ShippingCo')).toBeInTheDocument();
    expect(screen.getByText('Business Console')).toBeInTheDocument();
    expect(screen.getByText('Customer WhatsApp')).toBeInTheDocument();
  });
});

describe('Dashboard', () => {
  it('renders the three headline numbers, dispatch board and ledger', async () => {
    render(<App />);
    await goBusiness();
    expect(screen.getByText('Parcels moving')).toBeInTheDocument();
    expect(screen.getByText('Money to collect')).toBeInTheDocument();
    expect(screen.getByText('Booked today')).toBeInTheDocument();
    expect(screen.getByText("Today's dispatch")).toBeInTheDocument();
    expect(screen.getAllByText(/RT-201/).length).toBeGreaterThan(0);
    expect(screen.getByText('Recent bookings')).toBeInTheDocument();
  });

  it.each([
    ['/business/booking', 'Booking summary'],
    ['/business/packages', 'SBC104201'],
    ['/business/lots', 'Mumbai Metro Batch'],
    ['/business/routes', 'RT-102'],
    ['/business/feed', 'Sent automatically'],
    ['/business/receipts', 'Reprint'],
    ['/business/settings', 'Demo data'],
    ['/business/reports', 'Sales register'],
    ['/business/reports/gst', 'GST summary'],
    ['/business/eway', /Consignments over/],
  ])('route %s renders', async (hash, text) => {
    render(<App />);
    await goBusiness();
    await goto(hash);
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
  });
});

describe('Booking flow (reactivity proof)', () => {
  it('creates a booking; packages list updates live', async () => {
    render(<App />);
    await goBusiness();
    const before = db().bookings.length;
    await goto('/business/booking');
    await screen.findByText('Customer name');

    fireEvent.change(screen.getByLabelText(/Customer name/), { target: { value: 'Test Kumar' } });
    fireEvent.change(screen.getByLabelText(/WhatsApp number/), { target: { value: '9999999999' } });
    fireEvent.change(screen.getByLabelText(/Destination city/), { target: { value: 'Pune' } });
    fireEvent.click(screen.getByRole('button', { name: /Save booking/i }));

    await waitFor(() => expect(db().bookings.length).toBe(before + 1));
    expect(db().outbox.at(-1)!.text).toMatch(/Booking Confirmed/);
    await screen.findByText('Test Kumar');
  });
});

describe('Package detail + OTP loop', () => {
  it('advances status reactively inside open dialog; verifies delivery OTP', async () => {
    render(<App />);
    await goBusiness();
    await goto('/business/packages');
    await screen.findByText('SBC104210');

    fireEvent.click(screen.getByText('SBC104210'));
    await screen.findByText('Timeline');

    fireEvent.click(screen.getByRole('button', { name: /Check In at Hub/i }));
    await waitFor(() => expect(findByDocket('SBC104210')!.status).toBe('checked_in'));

    updateStatus(findByDocket('SBC104210')!.id, 'dispatched');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Out for Delivery/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Out for Delivery/i }));
    await waitFor(() => expect(findByDocket('SBC104210')!.status).toBe('out_for_delivery'));

    const b = findByDocket('SBC104210')!;
    expect(b.otp).toMatch(/^\d{4}$/);

    fireEvent.change(screen.getByLabelText(/Enter OTP/), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Delivery/i }));
    expect(await screen.findByText(/tries left/i)).toBeInTheDocument();  // toast; the timeline also logs the attempt

    fireEvent.change(screen.getByLabelText(/Enter OTP/), { target: { value: b.otp } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Delivery/i }));
    await waitFor(() => expect(findByDocket('SBC104210')!.status).toBe('delivered'));
  });
});

describe('Lots', () => {
  it('creates a lot via dialog', async () => {
    render(<App />);
    await goBusiness();
    await goto('/business/lots');
    await screen.findByText('Mumbai Metro Batch');

    fireEvent.click(screen.getByRole('button', { name: /^Create Lot$/ }));
    // destination-first: a city is pre-picked and its loose parcels pre-selected
    fireEvent.change(await screen.findByLabelText(/Lot name/), { target: { value: 'UI Test Lot' } });
    const create = screen.getByRole('button', { name: /Create with \d+ parcel/i });
    fireEvent.click(create);
    await waitFor(() => expect(db().lots.some((l) => l.name === 'UI Test Lot')).toBe(true));
    const made = db().lots.find((l) => l.name === 'UI Test Lot')!;
    expect(made.code).toMatch(/^LOT-[A-Z]{3}-\d{2}$/);      // code derived from destination
    expect(db().bookings.some((b) => b.lotId === made.id)).toBe(true); // parcels came with it
    expect(await screen.findByText('UI Test Lot')).toBeInTheDocument();
  });
});

describe('Routes + delay cascade', () => {
  it('reports delay from UI; affected customers notified', async () => {
    render(<App />);
    await goBusiness();
    await goto('/business/routes');
    await screen.findByText('RT-102');

    const before = db().outbox.length;
    fireEvent.click(screen.getAllByRole('button', { name: /Report Delay/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Send delay alert to \d+ customer/i }));

    await waitFor(() => expect(db().outbox.length).toBeGreaterThan(before));
    const sent = db().outbox.slice(before);
    expect(sent.some((m) => /Delay Update/.test(m.text))).toBe(true);
    expect(sent.every((m) => m.phone !== '+447700900004')).toBe(true); // delivered parcels excluded
    expect(screen.getAllByText(/Delayed/i).length).toBeGreaterThan(0);
  });

  it('depart event cascades parcel statuses + notifications', () => {
    const rte = createRoute({
      origin: 'Ahmedabad', destination: 'Surat', mode: 'Road',
      carrierCode: 'GJ-01-X', departAt: Date.now(), lotIds: [], bookingIds: ['bkg_karan'],
    });
    const before = db().outbox.length;
    postRouteEvent(rte.id, { type: 'depart', title: 'Departed Ahmedabad', note: '' });
    expect(findByDocket('SBC104210')!.status).toBe('dispatched');
    expect(db().outbox.length).toBe(before + 1);
    expect(db().outbox.at(-1)!.phone).toBe('+447700900005');
  });
});

describe('Automation feed', () => {
  it('lists queued outbound messages', async () => {
    queueMsg('+447700900001', 'Feed probe message');
    render(<App />);
    await goBusiness();
    await goto('/business/feed');
    expect(await screen.findByText(/Feed probe message/)).toBeInTheDocument();
    expect(screen.getByText(/Ravi Patel/)).toBeInTheDocument();
  });
});

describe('Customer WhatsApp view', () => {
  it('persona auto-selected, bot replies, proactive outbox lands in chat', async () => {
    render(<App />);
    window.location.hash = '/customer';
    await screen.findByText(/AI BOT/);

    const seedCount = document.querySelectorAll('.msg').length;
    expect(seedCount).toBeGreaterThan(0); // seeded history

    fireEvent.change(screen.getByPlaceholderText('Type a message'), { target: { value: 'menu' } });
    fireEvent.click(document.querySelector('.wa-send')!);
    expect(screen.getByText(/menu/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Track my parcel/).length).toBeGreaterThan(0), { timeout: 4000 });

    queueMsg('+447700900001', 'PROACTIVE TEST ALERT');
    await waitFor(() => expect(screen.getByText(/PROACTIVE TEST ALERT/)).toBeInTheDocument(), { timeout: 4000 });
  }, 20000);
});

describe('GST place of supply', () => {
  it('splits CGST + SGST intra-state and charges IGST inter-state', () => {
    const intra = addBooking({ name: 'Asha', phone: '+447700900021', to: 'Surat', weightKg: 1, packing: 100, freight: 100 });
    expect(intra.supply).toBe('intra');
    expect(intra.tax!.cgst).toBeGreaterThan(0);
    expect(intra.tax!.sgst).toBeGreaterThan(0);
    expect(intra.tax!.igst).toBe(0);

    const inter = addBooking({ name: 'Bala', phone: '+447700900022', to: 'Delhi', weightKg: 1, packing: 100, freight: 100 });
    expect(inter.supply).toBe('inter');
    expect(inter.tax!.igst).toBe(inter.tax!.gst);
    expect(inter.tax!.cgst).toBe(0);
    expect(inter.tax!.total).toBe(inter.tax!.taxable + inter.tax!.gst);

    // clean up test bookings so later runs stay deterministic
    const ids = new Set([intra.id, inter.id]);
    db().bookings = db().bookings.filter((b) => !ids.has(b.id));
  });

  it('e-way record stores Part-B vehicle and validity by distance', () => {
    const b = addBooking({ name: 'Chhaya', phone: '+447700900023', to: 'Mumbai', weightKg: 1, packing: 50, freight: 450, goodsValue: 90000 });
    setEwayBill(b.id, { no: '291234567890', vehicleNo: 'gj-01-ab-1234', distanceKm: 530 });
    const rec = findByDocket(b.docket)!.eway!;
    expect(rec.no).toBe('291234567890');
    expect(rec.vehicleNo).toBe('GJ-01-AB-1234');
    expect(ewayValidDays(530)).toBe(3);
    expect(ewayState(findByDocket(b.docket)!)).toBe('recorded');
    db().bookings = db().bookings.filter((x) => x.id !== b.id);
  });
});
