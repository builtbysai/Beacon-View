import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useMenuKeyboardNav } from './useMenuKeyboardNav';

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
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null);
  
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    
    const updatePosition = () => {
      if (!triggerRef.current || !menuRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      let top: number | undefined = undefined;
      let bottom: number | undefined = undefined;
      
      if (spaceBelow >= menuRect.height + 8 || spaceBelow > spaceAbove) {
        top = rect.bottom + 8;
      } else {
        bottom = window.innerHeight - rect.top + 8;
      }
      
      const right = window.innerWidth - rect.right;
      
      const pos: any = { right };
      if (top !== undefined) pos.top = top;
      if (bottom !== undefined) pos.bottom = bottom;
      setPosition(pos);
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', dismissOutside);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('pointerdown', dismissOutside);
    };
  }, [open]);

  useMenuKeyboardNav(open, menuRef, triggerRef, () => setOpen(false));

  return (
    <div className={anchorClassName} ref={anchorRef}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      {open && createPortal(
        <div 
          className={menuClassName} 
          role="menu" 
          ref={menuRef}
          style={{
            position: 'fixed',
            zIndex: 1000,
            ...((position ? { top: position.top ?? 'auto', bottom: position.bottom ?? 'auto', right: position.right ?? 'auto' } : { visibility: 'hidden', top: 0, left: 0 }))
          }}
        >
          {children(() => setOpen(false))}
        </div>,
        document.body
      )}
    </div>
  );
}
