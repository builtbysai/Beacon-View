import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Shared anchored "..." menu: outside-click and Escape dismissal, proper
 * `menu`/`menuitem` ARIA, no layout jump. Used anywhere a tile or surface
 * needs a few secondary actions behind one icon button instead of a row of
 * always-visible buttons (camera tiles, the live viewer's identity bar). */
export function OverflowMenu({
  label,
  buttonClassName = 'camera-tile-action camera-tile-more',
  menuClassName = 'camera-tile-menu',
  anchorClassName = 'camera-tile-menu-anchor',
  children,
}: {
  label: string;
  buttonClassName?: string;
  menuClassName?: string;
  anchorClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        setOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('keydown', dismissEscape);
    return () => {
      window.removeEventListener('pointerdown', dismissOutside);
      window.removeEventListener('keydown', dismissEscape);
    };
  }, [open]);

  return (
    <div className={anchorClassName} ref={ref}>
      <button
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className={menuClassName} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
