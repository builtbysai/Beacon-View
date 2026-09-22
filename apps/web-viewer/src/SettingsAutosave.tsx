import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type AutosaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'error' };

interface AutosaveContextValue {
  state: AutosaveState;
  /** Run one autosaving mutation. Multiple simultaneous callers are fine --
   * the indicator just reflects whichever is still in flight/most recent. */
  run: (task: () => Promise<void>) => void;
  /** Re-runs the most recently failed task, for the header's own "Retry". */
  retry: () => void;
}

const AutosaveContext = createContext<AutosaveContextValue | null>(null);

/** One quiet "Saving…/Saved" indicator for the whole Settings page, instead
 * of a Save button and a success state on every individual row. A control
 * that autosaves calls `run(() => request(...))` from useSettingsAutosave()
 * and nothing else -- no local saving/error state of its own. */
export function SettingsAutosaveProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<AutosaveState>({ status: 'idle' });
  const idleTimer = useRef<number | null>(null);
  const pending = useRef(0);
  const lastTask = useRef<(() => Promise<void>) | null>(null);

  const run = useCallback((task: () => Promise<void>) => {
    lastTask.current = task;
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    pending.current += 1;
    setState({ status: 'saving' });
    task()
      .then(() => {
        pending.current -= 1;
        if (pending.current > 0) return;
        setState({ status: 'saved' });
        idleTimer.current = window.setTimeout(() => {
          setState({ status: 'idle' });
        }, 2000);
      })
      .catch(() => {
        pending.current -= 1;
        setState({ status: 'error' });
      });
  }, []);

  const retry = useCallback(() => {
    if (lastTask.current) run(lastTask.current);
  }, [run]);

  const value = useMemo(() => ({ state, run, retry }), [state, run, retry]);

  return (
    <AutosaveContext.Provider value={value}>
      {children}
    </AutosaveContext.Provider>
  );
}

export function useSettingsAutosave(): AutosaveContextValue {
  const context = useContext(AutosaveContext);
  if (!context) {
    throw new Error(
      'useSettingsAutosave must be used within a SettingsAutosaveProvider',
    );
  }
  return context;
}

/** The one visible "Saving…/Saved/Couldn't save" indicator, placed once
 * near the Settings header -- not repeated per row. */
export function AutosaveIndicator() {
  const { state, retry } = useSettingsAutosave();
  return (
    <div className="settings-autosave" aria-live="polite">
      {state.status === 'saving' && <span>Saving…</span>}
      {state.status === 'saved' && <span className="is-saved">Saved</span>}
      {state.status === 'error' && (
        <span className="is-error">
          Couldn&rsquo;t save
          <button type="button" onClick={retry}>
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
