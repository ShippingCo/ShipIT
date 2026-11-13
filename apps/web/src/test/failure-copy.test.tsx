/**
 * The words a failure uses are a contract, not a detail.
 *
 * A shop reported the old wording from a live counter: "The outcome is uncertain.
 * We could not confirm whether this was saved. Retry the same request to check
 * before starting a new one." Every load-bearing word in it — outcome, request,
 * retry — is a system word, and the sentence never answers the only question the
 * operator has, which is whether the parcel is now booked and whether they should
 * take the customer's money again.
 *
 * These regressions hold the replacement in place. They are deliberately written
 * against the rendered text rather than against props, because the text is the
 * thing that was wrong.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandNotice } from '../operations/AsyncState';

describe('failure copy', () => {
  it('tells the operator the record may or may not have saved, in those words', () => {
    render(<CommandNotice phase="uncertain" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('We could not tell whether this saved.');
    expect(alert).toHaveTextContent('may or may not have gone through');
  });

  it('never uses the system vocabulary the shop could not read', () => {
    const { container } = render(<CommandNotice phase="uncertain" retry={() => {}} />);
    const text = container.textContent ?? '';
    for (const word of ['outcome', 'request', 'Retry', 'retry']) {
      expect(text).not.toContain(word);
    }
  });

  it('removes the fear of pressing the button, because that is why the screen gets abandoned', () => {
    render(<CommandNotice phase="uncertain" retry={() => {}} />);
    expect(screen.getByText(/will not save the same thing twice/i)).toBeInTheDocument();
  });

  it('offers one action, and it is phrased as checking rather than repeating', () => {
    const retry = vi.fn();
    render(<CommandNotice phase="uncertain" retry={retry} />);
    const button = screen.getByRole('button', { name: 'Check if it saved' });
    button.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows no button at all when there is nothing safe to press', () => {
    render(<CommandNotice phase="uncertain" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('states what happened to the money when a screen passes that line', () => {
    render(
      <CommandNotice
        phase="uncertain"
        money="The money may or may not be recorded. Do not take it from the customer again until you have checked."
      />,
    );
    expect(screen.getByText(/Do not take it from the customer again/)).toBeInTheDocument();
  });

  it('leaves the money line out on a screen where no money moves', () => {
    const { container } = render(<CommandNotice phase="uncertain" />);
    expect(container.querySelector('.ops-uncertain-money')).toBeNull();
  });

  it('says plainly that a rejected change was not saved', () => {
    render(<CommandNotice phase="error" code="VERSION_CONFLICT" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Not saved.');
    expect(alert).toHaveTextContent('Reload to see the current state.');
  });

  it('keeps the error code as a quiet support handle, not as the message', () => {
    const { container } = render(<CommandNotice phase="error" code="VERSION_CONFLICT" />);
    const code = container.querySelector('.ops-alert-code');
    expect(code).not.toBeNull();
    expect(code?.textContent?.trim()).toBe('VERSION_CONFLICT');
  });

  it('reports saving and saved without naming the server, which the operator cannot see', () => {
    // The Material Symbols ligature renders its own name as text, so the icon's
    // label is part of textContent. Match on the words, not the whole string.
    const { rerender, container } = render(<CommandNotice phase="pending" />);
    expect(container.textContent).toContain('Saving…');
    expect(container.textContent).not.toContain('server');
    rerender(<CommandNotice phase="confirmed" />);
    expect(container.textContent).toContain('Saved.');
    expect(container.textContent).not.toContain('server');
  });
});
