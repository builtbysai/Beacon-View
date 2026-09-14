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
  explicitActions = false,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  explicitActions?: boolean;
}) {
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  function commit(input: HTMLInputElement) {
    if (settled.current) return;
    settled.current = true;
    const next = input.value.trim();
    if (next && next !== value) onSubmit(next);
    else onCancel();
  }
  const input = (
    <input
      ref={inputRef}
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
      onBlur={
        explicitActions ? undefined : (event) => commit(event.currentTarget)
      }
    />
  );
  if (!explicitActions) return input;
  return (
    <div className="inline-rename-editor">
      {input}
      <div className="inline-rename-actions">
        <button
          type="button"
          onClick={() => inputRef.current && commit(inputRef.current)}
        >
          Save
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            settled.current = true;
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
