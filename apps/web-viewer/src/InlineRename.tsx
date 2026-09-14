import { useRef } from 'react';

/** A lightweight inline text editor for renaming something in place, used
 * wherever a name is already visible in the UI (a camera tile, a settings
 * heading) instead of opening a full dialog. Enter saves, Escape cancels,
 * and clicking away saves too (so it behaves like a normal text field, not
 * a hidden gesture). */
export function InlineRename({
  value,
  ariaLabel,
  className = '',
  onSubmit,
  onCancel,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const settled = useRef(false);
  function commit(input: HTMLInputElement) {
    if (settled.current) return;
    settled.current = true;
    const next = input.value.trim();
    if (next && next !== value) onSubmit(next);
    else onCancel();
  }
  return (
    <input
      className={`inline-rename ${className}`.trim()}
      aria-label={ariaLabel}
      defaultValue={value}
      maxLength={100}
      autoFocus
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(event.currentTarget);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settled.current = true;
          onCancel();
        }
      }}
      onBlur={(event) => commit(event.currentTarget)}
    />
  );
}
