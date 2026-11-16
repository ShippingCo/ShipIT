/**
 * The bar that appears when parcels are ticked on the Packages list.
 *
 * Three defects it used to have, each of which is a dead end for a counter clerk
 * rather than a cosmetic problem:
 *
 *  - "2 selected" counts selections. The operator is about to move other people's
 *    parcels and needs a count of parcels.
 *  - An action they can see but cannot press, with no visible reason, reads as a
 *    broken button. The reason lived in a `title` attribute nobody hovers.
 *  - Ticking a parcel and then changing the filter hid the row while keeping it
 *    chosen, so the count disagreed with the table and nothing said why.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BulkBar } from '../operations/SavedBookings';

const bar = (over: Partial<React.ComponentProps<typeof BulkBar>> = {}) =>
  render(<BulkBar chosen={2} drafts={0} hidden={0} notBooked={0} notAtHub={2}
    enabled busy={false} act={over.act ?? (() => {})} clear={() => {}} {...over} />);

describe('packages bulk bar', () => {
  it('counts parcels, not selections', () => {
    bar();
    expect(screen.getByText('2 parcels chosen')).toBeInTheDocument();
  });

  it('says "parcel" when there is one of them', () => {
    bar({ chosen: 1, notAtHub: 1 });
    expect(screen.getByText('1 parcel chosen')).toBeInTheDocument();
  });

  it('discloses parcels the current filter is hiding, so the count never silently disagrees with the table', () => {
    bar({ chosen: 3, hidden: 1, notAtHub: 3 });
    expect(screen.getByText('1 not shown by this filter')).toBeInTheDocument();
  });

  it('says nothing about hiding when nothing is hidden', () => {
    bar();
    expect(screen.queryByText(/not shown by this filter/)).not.toBeInTheDocument();
  });

  it('names the reason an action cannot be pressed, on the screen rather than in a tooltip', () => {
    bar({ chosen: 3, notAtHub: 2, notBooked: 0 });
    const why = screen.getByText(/Cannot send out/);
    expect(why).toBeInTheDocument();
    expect(why).toHaveTextContent('2 of the 3 are not at a hub yet');
  });

  it('calls drafts what they are, instead of listing them as the wrong state', () => {
    bar({ chosen: 2, drafts: 2, notBooked: 2, notAtHub: 2 });
    expect(screen.getByText(/Those are drafts, not booked parcels yet\./)).toBeInTheDocument();
  });

  it('keeps a blocked action visible and disabled rather than removing it', () => {
    bar({ chosen: 2, notAtHub: 2 });
    const send = screen.getByRole('button', { name: /Send out for delivery/ });
    expect(send).toBeVisible();
    expect(send).toBeDisabled();
  });

  it('leaves a valid action pressable and reports which one was pressed', () => {
    const act = vi.fn();
    bar({ chosen: 2, notBooked: 0, notAtHub: 2, act });
    const checkIn = screen.getByRole('button', { name: /Check in at hub/ });
    expect(checkIn).toBeEnabled();
    checkIn.click();
    expect(act).toHaveBeenCalledWith('check_in');
  });

  it('shows no reason line at all when every chosen parcel is eligible for everything', () => {
    bar({ chosen: 2, notBooked: 0, notAtHub: 0 });
    expect(screen.queryByText(/Cannot /)).not.toBeInTheDocument();
  });

  it('offers no action that can never be pressed', () => {
    // "Move to lot" used to sit here permanently disabled with a tooltip. A control
    // that is never pressable is not a control.
    bar();
    expect(screen.queryByRole('button', { name: /Move to lot/i })).not.toBeInTheDocument();
  });

  it('disables everything while an update is running, so a second press cannot start one', () => {
    bar({ enabled: false, busy: true, notAtHub: 0, notBooked: 0 });
    expect(screen.getByRole('button', { name: /Check in at hub/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send out for delivery/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});
