import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
const items = [
  { label: 'Home', icon: 'home' as const, current: true, onSelect: vi.fn() },
];
describe('desktop sidebar preference', () => {
  it('restores collapse while keeping navigation and sign-out accessible', () => {
    const onLogout = vi.fn();
    const view = render(
      <Sidebar email="owner@example.test" items={items} onLogout={onLogout} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLogout).toHaveBeenCalledOnce();
    view.unmount();
    render(
      <Sidebar email="owner@example.test" items={items} onLogout={onLogout} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('beacon.sidebar.collapsed.v1')).toBe('false');
  });
  it('remains operable when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    render(
      <Sidebar email="owner@example.test" items={items} onLogout={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(items[0]!.onSelect).toHaveBeenCalledOnce();
  });
});
