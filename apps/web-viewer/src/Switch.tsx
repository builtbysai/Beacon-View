/** A real checkbox styled as a switch -- native semantics (label
 * association, keyboard, screen reader "checked/not checked"), not a div
 * or button pretending to be one. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      className="switch-input"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
