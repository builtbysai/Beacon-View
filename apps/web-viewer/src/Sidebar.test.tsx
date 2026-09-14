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
    fireEvent.click(
      screen.getByRole('button', { name: /owner@example\.test/ }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
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

describe('account menu', () => {
  it('renders a Google avatar photo and falls back to an initial if it fails to load', () => {
    const { container } = render(
      <Sidebar
        email="owner@example.test"
        avatarUrl="https://lh3.googleusercontent.com/a/photo"
        items={items}
        onLogout={vi.fn()}
      />,
    );
    const image = container.querySelector('img.avatar');
    expect(image).toHaveAttribute(
      'src',
      'https://lh3.googleusercontent.com/a/photo',
    );
    fireEvent.error(image!);
    expect(container.querySelector('img.avatar')).not.toBeInTheDocument();
    expect(screen.getByText('O')).toBeInTheDocument();
  });

  it('closes on Escape and on an outside click', () => {
    render(
      <div>
        <button type="button">Outside</button>
        <Sidebar email="owner@example.test" items={items} onLogout={vi.fn()} />
      </div>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /owner@example\.test/ }),
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /owner@example\.test/ }),
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('supports roving-tabindex keyboard navigation and returns focus on Escape', () => {
    render(
      <Sidebar email="owner@example.test" items={items} onLogout={vi.fn()} />,
    );
    const trigger = screen.getByRole('button', {
      name: /owner@example\.test/,
    });
    fireEvent.click(trigger);
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems[0]).toHaveFocus();
    expect(menuItems[0]).toHaveAttribute('tabindex', '0');
    expect(menuItems[1]).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(menuItems[0]!, { key: 'ArrowDown' });
    expect(menuItems[1]).toHaveFocus();
    expect(menuItems[1]).toHaveAttribute('tabindex', '0');
    expect(menuItems[0]).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(menuItems[1]!, { key: 'ArrowDown' });
    expect(menuItems[0]).toHaveFocus();

    fireEvent.keyDown(menuItems[0]!, { key: 'End' });
    expect(menuItems[1]).toHaveFocus();

    fireEvent.keyDown(menuItems[1]!, { key: 'Home' });
    expect(menuItems[0]).toHaveFocus();

    fireEvent.keyDown(menuItems[0]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
