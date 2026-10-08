import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from './AppErrorBoundary';

function Broken(): never {
  throw new Error('render failed');
}

describe('AppErrorBoundary', () => {
  it('shows a way back instead of a blank page', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(
      screen.getByRole('button', { name: 'Reload Beacon' }),
    ).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
