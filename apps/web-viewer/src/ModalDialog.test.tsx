import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModalDialog } from './ModalDialog';

afterEach(cleanup);

it('takes focus and dismisses on the modal cancel action', () => {
  const onDismiss = vi.fn();
  render(
    <ModalDialog labelledBy="dialog-title" onDismiss={onDismiss}>
      <section>
        <h2 id="dialog-title">Pair a device</h2>
        <button>Cancel</button>
      </section>
    </ModalDialog>,
  );
  expect(screen.getByRole('dialog')).toHaveAttribute('open');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  fireEvent(
    screen.getByRole('dialog'),
    new Event('cancel', { bubbles: false, cancelable: true }),
  );
  expect(onDismiss).toHaveBeenCalledOnce();
});
