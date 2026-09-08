import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '../components/m3/Kpi';

describe('Sparkline hook order', () => {
  it('can change between empty and populated series without changing hook order', () => {
    const { container, rerender } = render(<Sparkline values={[]} />);
    expect(container.querySelector('svg')).toBeNull();
    rerender(<Sparkline values={[1, 2, 3]} />);
    const firstId = container.querySelector('linearGradient')?.id;
    expect(firstId).toBeTruthy();
    rerender(<Sparkline values={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
    rerender(<Sparkline values={[3, 4]} />);
    expect(container.querySelector('linearGradient')?.id).toBe(firstId);
  });
});
