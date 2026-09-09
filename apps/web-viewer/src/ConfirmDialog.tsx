import type { ReactNode } from 'react';
import { ModalDialog } from './ModalDialog';

/** Shared confirmation step for destructive/irreversible actions (delete
 * camera, delete device, revoke a session, delete the account…), replacing
 * ad hoc `window.confirm()` calls with a dialog that matches the rest of
 * the app's action hierarchy — a calm secondary "Cancel" next to a clearly
 * destructive confirm action, with room for the detailed caveats that
 * shouldn't live in the settings row above it. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalDialog labelledBy="confirm-dialog-title" onDismiss={onCancel}>
      <section aria-labelledby="confirm-dialog-title" className="confirm-modal">
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="confirm-modal-body">{description}</div>
        <div className="heading-actions confirm-modal-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={destructive ? 'danger' : ''}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </section>
    </ModalDialog>
  );
}
