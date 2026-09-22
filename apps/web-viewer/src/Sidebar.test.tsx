import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, SidebarProvider, SidebarTrigger } from './Sidebar';
import React from 'react';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const items = [
  { label: 'Home', icon: 'home' as const, current: true, onSelect: vi.fn() },
];

function TestSidebar() {
  return (
    <SidebarProvider>
      <SidebarTrigger />
      <Sidebar email="owner@example.test" items={items} onLogout={vi.fn()} />
    </SidebarProvider>
  );
}

describe('desktop sidebar preference', () => {
  it('restores collapse while keeping navigation and sign-out accessible', () => {
    const onLogout = vi.fn();
    const view = render(
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar email="owner@example.test" items={items} onLogout={onLogout} />
      </SidebarProvider>,
    );

    // Default is expanded, so trigger will collapse it
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Toggle Sidebar' })[0]!,
    );

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
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar email="owner@example.test" items={items} onLogout={onLogout} />
      </SidebarProvider>,
    );

    // It should remember it is collapsed
    expect(localStorage.getItem('beacon.sidebar.state')).toBe('collapsed');
    // Clicking trigger will expand it
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Toggle Sidebar' })[0]!,
    );
    expect(localStorage.getItem('beacon.sidebar.state')).toBe('expanded');
  });

  it('remains operable when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    render(<TestSidebar />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Toggle Sidebar' })[0]!,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(items[0]!.onSelect).toHaveBeenCalledOnce();
  });
});

describe('account menu', () => {
  it('renders a Google avatar photo and falls back to an initial if it fails to load', () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar
          email="owner@example.test"
          avatarUrl="https://lh3.googleusercontent.com/a/photo"
          items={items}
          onLogout={vi.fn()}
        />
      </SidebarProvider>,
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
        <TestSidebar />
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

  it('portals the collapsed account menu outside the clipped sidebar', () => {
    render(<TestSidebar />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Toggle Sidebar' })[0]!,
    ); // Collapse
    fireEvent.click(
      screen.getByRole('button', { name: /owner@example\.test/ }),
    );

    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(
      screen.getByRole('menuitem', { name: /Trust & privacy/ }),
    ).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Sign out/ })).toBeVisible();
  });

  it('supports the standard control-b sidebar shortcut', () => {
    render(<TestSidebar />);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem('beacon.sidebar.state')).toBe('collapsed');
  });
});
