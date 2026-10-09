/* global window, document */
// Beacon's Cast receiver (ADR 0097). It runs on the TV. The sender sends one
// message naming a path on this site; only a guest-link path is ever opened,
// inside a frame on this same origin.
export const NAMESPACE = 'urn:x-cast:com.beaconsecureview.cast';

const GUEST_PATH = /^\/g\/[A-Za-z0-9_-]{32,512}\?cast=1$/u;

/** The path to open for a message, or null for anything else. */
export function watchPath(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.type !== 'watch') return null;
  return typeof message.path === 'string' && GUEST_PATH.test(message.path)
    ? message.path
    : null;
}

export function start(frame, idle) {
  const context = window.cast.framework.CastReceiverContext.getInstance();
  const show = (path) => {
    frame.hidden = path === null;
    idle.hidden = path !== null;
    frame.src = path ?? 'about:blank';
  };
  context.addCustomMessageHandler(NAMESPACE, (event) => {
    const data = event.data;
    if (data && data.type === 'stop') {
      show(null);
      return;
    }
    const path = watchPath(data);
    if (path) show(path);
  });
  context.start({
    customNamespaces: {
      [NAMESPACE]: window.cast.framework.system.MessageType.JSON,
    },
    // A camera can be watched for hours; the TV must not time the receiver out.
    disableIdleTimeout: true,
  });
}

if (typeof window !== 'undefined' && window.cast && window.cast.framework) {
  start(document.getElementById('camera'), document.getElementById('idle'));
}
