import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OverflowMenu } from './OverflowMenu';

afterEach(() => {
  cleanup();
});

function renderMenu() {
  return render(
    <div>
      <button type="button">Outside</button>
      <OverflowMenu label="Camera options">
        {(close) => (
          <>
            <button role="menuitem" type="button" disabled>
              Unavailable action
            </button>
            <button role="menuitem" type="button" onClick={close}>
              First
            </button>
            <button role="menuitem" type="button" onClick={close}>
              Second
            </button>
            <button role="menuitem" type="button" onClick={close}>
              Third
            </button>
          </>
        )}
      </OverflowMenu>
    </div>,
  );
}

describe('OverflowMenu', () => {
  it('opens on click and closes on an outside click', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Camera options' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('focuses the first enabled item on open and skips disabled items in roving tabindex', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Camera options' }));
    const first = screen.getByRole('menuitem', { name: 'First' });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '0');
    expect(
      screen.getByRole('menuitem', { name: 'Unavailable action' }),
    ).not.toHaveAttribute('tabindex', '0');
  });

  it('navigates with ArrowDown/ArrowUp/Home/End and wraps at the ends', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Camera options' }));
    const first = screen.getByRole('menuitem', { name: 'First' });
    const second = screen.getByRole('menuitem', { name: 'Second' });
    const third = screen.getByRole('menuitem', { name: 'Third' });

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: 'ArrowDown' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(third).toHaveFocus();

    fireEvent.keyDown(third, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(third).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger button', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Camera options' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'First' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('invokes the close callback passed to an item', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Camera options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Second' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
