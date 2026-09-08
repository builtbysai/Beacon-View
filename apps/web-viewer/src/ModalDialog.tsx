import { useEffect, useRef, type ReactNode } from 'react';

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
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('button, a, input')?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
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
