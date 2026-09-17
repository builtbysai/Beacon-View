import { useEffect, useRef, type ReactNode } from 'react';
import './ModalDialog.css';

export function ModalDialog({
  children,
  labelledBy,
  onDismiss,
}: {
  children: ReactNode;
  labelledBy: string;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // `showModal()` already makes the rest of the page inert to clicks,
    // taps, and keyboard focus, but it does not stop the page behind the
    // dialog from scrolling (wheel/touch scroll isn't blocked by inertness
    // alone), so lock it explicitly. Also remember what had focus so it can
    // be restored once the dialog closes, instead of focus silently
    // resetting to the body.
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('button, a, input')?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal-backdrop"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </dialog>
  );
}
