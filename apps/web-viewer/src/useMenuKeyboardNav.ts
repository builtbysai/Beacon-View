import { useEffect, useRef, type RefObject } from 'react';

const MENU_ITEM_SELECTOR = '[role="menuitem"]';

function focusableMenuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
  ).filter((item) => !(item as HTMLButtonElement).disabled);
}

/** Wires the WAI-ARIA menu-button keyboard pattern onto an already-rendered
 * `role="menu"` popup: roving tabindex, ArrowUp/ArrowDown/Home/End
 * navigation between items, and Escape closing the menu and returning focus
 * to the button that opened it. Used by `OverflowMenu` and the sidebar
 * account menu so both popups behave the same way for keyboard users. */
export function useMenuKeyboardNav(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const activeIndex = useRef(0);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;

    const setTabIndexes = (index: number) => {
      const items = focusableMenuItems(menu);
      items.forEach((item, i) => {
        item.tabIndex = i === index ? 0 : -1;
      });
      return items;
    };
    const focusIndex = (index: number) => {
      const items = focusableMenuItems(menu);
      if (items.length === 0) return;
      const next = ((index % items.length) + items.length) % items.length;
      activeIndex.current = next;
      setTabIndexes(next);
      items[next]?.focus();
    };

    activeIndex.current = 0;
    setTabIndexes(0)[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusIndex(activeIndex.current + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusIndex(activeIndex.current - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusIndex(0);
          break;
        case 'End':
          event.preventDefault();
          focusIndex(focusableMenuItems(menu).length - 1);
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          triggerRef.current?.focus();
          break;
      }
    };
    // Tabbing (or an item's own action) moving focus outside the menu closes
    // it, matching the existing outside-pointer-click dismissal.
    const onFocusOut = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        menu.contains(event.relatedTarget)
      )
        return;
      onClose();
    };

    menu.addEventListener('keydown', onKeyDown);
    menu.addEventListener('focusout', onFocusOut);
    return () => {
      menu.removeEventListener('keydown', onKeyDown);
      menu.removeEventListener('focusout', onFocusOut);
    };
  }, [open, menuRef, triggerRef, onClose]);
}
