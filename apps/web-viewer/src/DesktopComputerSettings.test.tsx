import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesktopComputerSettings } from './DesktopComputerSettings';

afterEach(() => {
  cleanup();
  delete window.beaconDesktop;
});

describe('DesktopComputerSettings', () => {
  it('reads and changes start-at-sign-in through the desktop app', async () => {
    const setAutostart = vi.fn((enabled: boolean) => Promise.resolve(enabled));
    window.beaconDesktop = {
      getAutostart: () => Promise.resolve(false),
      setAutostart,
      setCaptureActive: vi.fn(),
      version: 1,
    };
    render(<DesktopComputerSettings />);
    const toggle = await screen.findByRole('switch', {
      name: 'Start Beacon when this computer starts',
    });
    await vi.waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(toggle).toBeChecked());
    expect(setAutostart).toHaveBeenCalledWith(true);
  });

  it('explains when this build cannot start with the computer', async () => {
    window.beaconDesktop = {
      getAutostart: () => Promise.resolve(false),
      setAutostart: () => Promise.resolve(false),
      setCaptureActive: vi.fn(),
      version: 1,
    };
    render(<DesktopComputerSettings />);
    const toggle = await screen.findByRole('switch', {
      name: 'Start Beacon when this computer starts',
    });
    await vi.waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    expect(
      await screen.findByText(/available in the installed Beacon app/),
    ).toBeVisible();
    expect(toggle).not.toBeChecked();
  });
});
