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

    const trigger = document.activeElement as HTMLElement | null;
    const scrollHost = document.querySelector<HTMLElement>('.main-content');
    const previousOverflowY = scrollHost?.style.overflowY ?? '';

    /* Beacon scrolls the authenticated workspace inside .main-content. Lock
       that real scroll host rather than body; scrollbar-gutter is reserved in
       CSS so the page does not move sideways when the modal appears. Public
       pages that do not have .main-content rely on the native modal behavior. */
    if (scrollHost) scrollHost.style.overflowY = 'hidden';

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    dialog.querySelector<HTMLElement>('button, a, input, select, textarea')?.focus();

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (scrollHost) scrollHost.style.overflowY = previousOverflowY;
      trigger?.focus({ preventScroll: true });
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
