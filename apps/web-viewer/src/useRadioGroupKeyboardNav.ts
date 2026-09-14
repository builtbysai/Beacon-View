import { useEffect, useLayoutEffect, type RefObject } from 'react';

const RADIO_SELECTOR = '[role="radio"]';

function radios(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(RADIO_SELECTOR));
}

function enabledRadios(container: HTMLElement): HTMLElement[] {
  return radios(container).filter(
    (item) => !(item as HTMLButtonElement).disabled,
  );
}

/** Wires the WAI-ARIA radio-group keyboard pattern onto a `role="radiogroup"`
 * built from `role="radio"` buttons: only the checked (or first enabled)
 * option is tabbable, and ArrowLeft/Up/Right/Down move focus to, and select,
 * the previous/next option, wrapping at the ends. Used by the camera-
 * availability and motion-event time filter pills, which render plain
 * buttons rather than native `<input type="radio">` elements. */
export function useRadioGroupKeyboardNav(
  containerRef: RefObject<HTMLElement | null>,
) {
  // Keep roving tabindex in sync with whichever option is selected, which
  // can change after any render (a click, or the key handler below).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = radios(container);
    const checkedIndex = items.findIndex(
      (item) => item.getAttribute('aria-checked') === 'true',
    );
    const activeIndex = checkedIndex >= 0 ? checkedIndex : 0;
    items.forEach((item, i) => {
      item.tabIndex = i === activeIndex ? 0 : -1;
    });
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      if (!forward && !backward) return;
      const items = enabledRadios(container);
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const base = current === -1 ? 0 : current;
      const step = forward ? 1 : -1;
      const nextIndex =
        (((base + step) % items.length) + items.length) % items.length;
      const next = items[nextIndex]!;
      event.preventDefault();
      next.focus();
      next.click();
    };
    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [containerRef]);
}
