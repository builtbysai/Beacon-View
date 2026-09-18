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
    const scrollTop = scrollHost?.scrollTop ?? 0;
    let restoreFrame = 0;

    /* Native modal dialogs already make the rest of the page inert. Do not
       toggle the workspace scrollbar on open: removing that scrollbar was
       enough to make the whole app visibly jump sideways. The backdrop
       contains scroll chaining in CSS, while we preserve the workspace's
       exact scroll position through the browser's initial dialog focus. */
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    dialog
      .querySelector<HTMLElement>('button, a, input, select, textarea')
      ?.focus({ preventScroll: true });

    if (scrollHost) {
      scrollHost.scrollTop = scrollTop;
      restoreFrame = requestAnimationFrame(() => {
        scrollHost.scrollTop = scrollTop;
      });
    }

    return () => {
      if (restoreFrame) cancelAnimationFrame(restoreFrame);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (scrollHost) scrollHost.scrollTop = scrollTop;
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
