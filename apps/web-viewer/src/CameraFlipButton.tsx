import { Icon } from './Icon';

/** A compact camera-flip control replacing the old source dropdown: one tap
 * cycles to the next registered source (the common front/rear case is
 * exactly a two-way flip; more sources just keep cycling). Used on the live
 * viewer and in camera settings — anywhere a device has more than one
 * source and the active one can be switched. */
export function CameraFlipButton({
  sources,
  activeId,
  onSwitch,
  busy = false,
  className = '',
}: {
  sources: { id: string; name: string }[];
  activeId: string;
  onSwitch: (id: string) => void;
  busy?: boolean;
  className?: string;
}) {
  if (sources.length < 2) return null;
  const index = sources.findIndex((source) => source.id === activeId);
  const next = sources[(index + 1) % sources.length]!;
  return (
    <button
      type="button"
      className={`camera-flip-button ${className}`.trim()}
      aria-label={`Switch camera (currently ${sources[index]?.name ?? 'unknown'}, switch to ${next.name})`}
      title={`Switch to ${next.name}`}
      disabled={busy}
      onClick={() => onSwitch(next.id)}
    >
      <Icon name="flip" />
    </button>
  );
}
