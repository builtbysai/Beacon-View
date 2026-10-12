import { useRef, useState, type RefObject } from 'react';
import { Icon, type IconName } from './Icon';
import { useMenuKeyboardNav } from './useMenuKeyboardNav';
import './LiveViewerMenu.css';

export interface ViewerMenuItem {
  id: string;
  icon: IconName;
  label: string;
  /** Short current value shown at the end of the row. */
  value?: string | undefined;
  ariaLabel?: string | undefined;
  pressed?: boolean | undefined;
  disabled?: boolean;
  /** Keeps the menu open so the new value can be seen (sleep timer, fit). */
  keepOpen?: boolean;
  onSelect: () => void;
}

export interface ViewerMenuGroup {
  id: string;
  label: string;
  items: ViewerMenuItem[];
}

/** The "More" control of the live view. It renders inside the live surface
 * (not in a portal) so it is still visible when that surface is full screen. */
export function LiveViewerMenu({
  groups,
  triggerRef,
  onOpenChange,
}: {
  groups: ViewerMenuGroup[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = groups.filter((group) => group.items.length > 0);

  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
  }

  useMenuKeyboardNav(open, menuRef, triggerRef, () => setOpen(false));

  if (visible.length === 0) return null;
  return (
    <div className="viewer-menu-anchor">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={`video-control${open ? ' is-open' : ''}`}
        onClick={() => setOpen(!open)}
        ref={triggerRef}
        title="More"
        type="button"
      >
        <Icon name="more" />
        <span className="visually-hidden">More</span>
      </button>
      {open && (
        <div
          aria-label="More live view options"
          className="viewer-menu"
          ref={menuRef}
          role="menu"
        >
          {visible.map((group) => (
            <div
              aria-label={group.label}
              className="viewer-menu-group"
              key={group.id}
              role="group"
            >
              <span aria-hidden="true" className="viewer-menu-heading">
                {group.label}
              </span>
              {group.items.map((item) => (
                <button
                  aria-checked={item.pressed}
                  aria-describedby={
                    item.ariaLabel ? `viewer-menu-note-${item.id}` : undefined
                  }
                  className="viewer-menu-item"
                  disabled={item.disabled}
                  key={item.id}
                  onClick={() => {
                    item.onSelect();
                    if (!item.keepOpen) {
                      setOpen(false);
                      triggerRef.current?.focus({ preventScroll: true });
                    }
                  }}
                  role={
                    item.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'
                  }
                  type="button"
                >
                  <Icon name={item.icon} />
                  <span className="viewer-menu-label">{item.label}</span>
                  {item.value && (
                    <span className="viewer-menu-value">{item.value}</span>
                  )}
                  {/* The visible words are the name (so voice control can say them); this adds the detail. */}
                  {item.ariaLabel && (
                    <span
                      className="visually-hidden"
                      id={`viewer-menu-note-${item.id}`}
                    >
                      {item.ariaLabel}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
