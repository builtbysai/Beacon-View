import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { LiveVideo } from './LiveVideo';

type LiveProps = ComponentProps<typeof LiveVideo>;

interface Claim {
  claim: (props: LiveProps) => void;
  release: () => void;
}

const LivePlayerContext = createContext<Claim | null>(null);

/**
 * Keeps the live player mounted above the pages (ADR 0091).
 *
 * The live view claims the player while it is on screen. When someone leaves
 * it, the player normally closes with it. If the video is floating in a
 * picture-in-picture window, it stays mounted but hidden instead, so the
 * floating window keeps playing while they use the rest of Beacon. It closes
 * when the floating window is closed, or when another camera is opened.
 * Coming back to the same camera reuses the connection: no reconnect.
 */
export function LivePlayerProvider({ children }: { children: ReactNode }) {
  const propsRef = useRef<LiveProps | null>(null);
  const [version, setVersion] = useState(0);
  const [visible, setVisible] = useState(false);
  const [floating, setFloating] = useState(false);
  const floatingRef = useRef(false);
  floatingRef.current = floating;

  const visibleRef = useRef(false);
  visibleRef.current = visible;

  const claim = useCallback((props: LiveProps) => {
    // Coming back to a player that was floating while parked: the floating
    // window has done its job, so bring the picture back to the page.
    if (!visibleRef.current && floatingRef.current)
      void document.exitPictureInPicture?.().catch(() => undefined);
    propsRef.current = props;
    setVisible(true);
    setVersion((value) => value + 1);
  }, []);

  const release = useCallback(() => {
    if (floatingRef.current) {
      setVisible(false);
      return;
    }
    propsRef.current = null;
    setVisible(false);
    setVersion((value) => value + 1);
  }, []);

  // Hidden and no longer floating (its window was closed): let the player go.
  useEffect(() => {
    if (!visible && !floating && propsRef.current) {
      propsRef.current = null;
      setVersion((value) => value + 1);
    }
  }, [visible, floating]);

  const value = useMemo(() => ({ claim, release }), [claim, release]);
  const props = propsRef.current;
  void version;

  return (
    <LivePlayerContext.Provider value={value}>
      {children}
      {props && (
        // Hidden by moving it off-screen, never with display:none: a video
        // that isn't rendered is taken out of picture-in-picture.
        <div
          aria-hidden={!visible}
          className={`live-player${visible ? '' : ' is-parked'}`}
          inert={!visible}
        >
          <LiveVideo
            key={props.camera.id}
            {...props}
            onPictureInPictureChange={(active) => {
              setFloating(active);
              props.onPictureInPictureChange?.(active);
            }}
          />
        </div>
      )}
    </LivePlayerContext.Provider>
  );
}

/** The live page: asks the host to show the live player with these props.
 * Renders nothing itself. */
export function LivePlayerSlot(props: LiveProps) {
  const host = useContext(LivePlayerContext);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    host?.claim(latest.current);
  });
  useEffect(() => () => host?.release(), [host]);
  return null;
}
