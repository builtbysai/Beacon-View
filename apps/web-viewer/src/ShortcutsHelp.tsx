import { ModalDialog } from './ModalDialog';
import { SHORTCUT_HELP } from './live-shortcuts';

/** The keyboard shortcuts for the live view, opened with `?`. */
export function ShortcutsHelp({ onDismiss }: { onDismiss: () => void }) {
  return (
    <ModalDialog
      className="shortcuts-help"
      labelledBy="shortcuts-title"
      onDismiss={onDismiss}
    >
      <section>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <dl className="shortcuts-list">
          {SHORTCUT_HELP.map((item) => (
            <div key={item.keys}>
              <dt>
                <kbd>{item.keys}</kbd>
              </dt>
              <dd>{item.label}</dd>
            </div>
          ))}
        </dl>
        <p className="shortcuts-note">
          Zoom also works with the mouse wheel, a pinch, or a double-click.
        </p>
        <button className="secondary" onClick={onDismiss} type="button">
          Close
        </button>
      </section>
    </ModalDialog>
  );
}
