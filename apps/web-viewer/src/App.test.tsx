import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('clearly identifies the foundation and inactive capture state', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Beacon SecureView' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'no media capture is active',
    );
  });
});
