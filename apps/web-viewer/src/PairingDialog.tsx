import { QRCodeSVG } from 'qrcode.react';
import { ModalDialog } from './ModalDialog';
import { pairingLink } from './app-navigation';
import type { PairingLifecycle } from './lifecycle';

type PairingDialogProps = {
  busy: boolean;
  code: string;
  error: string;
  state: PairingLifecycle;
  onCopyError: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  reconnecting?: boolean;
};

export function PairingDialog({
  busy,
  code,
  error,
  state,
  onCopyError,
  onDismiss,
  onRetry,
  reconnecting = false,
}: PairingDialogProps) {
  return (
    <ModalDialog labelledBy="pair-title" onDismiss={onDismiss}>
      <section aria-labelledby="pair-title" className="pair-modal">
        {state === 'completed' ? (
          <div className="pair-success" role="status">
            <span aria-hidden="true">✓</span>
            <h2 id="pair-title">Camera connected</h2>
            <p>Taking you to Cameras…</p>
          </div>
        ) : (
          <>
            <p className="eyebrow">
              {reconnecting ? 'Reconnect' : 'New camera'}
            </p>
            <h2 id="pair-title">
              {reconnecting ? 'Reconnect camera' : 'Pair a device'}
            </h2>
            <p>
              {reconnecting
                ? 'On the disconnected Android camera, scan this code to restore its existing settings.'
                : 'Scan with Beacon on Android, or share this one-time setup link.'}
            </p>
            {code ? (
              <div className="pairing" role="status">
                <QRCodeSVG
                  aria-label="Beacon pairing QR code"
                  bgColor="#ffffff"
                  fgColor="#101820"
                  level="M"
                  marginSize={2}
                  size={180}
                  title="Scan with Beacon on Android"
                  value={pairingLink(code)}
                />
                <div className="pairing-code-copy">
                  <strong>{code}</strong>
                  <span>Expires in 10 minutes</span>
                  <button
                    className="secondary"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(pairingLink(code))
                        .catch(onCopyError)
                    }
                  >
                    Copy setup link
                  </button>
                </div>
              </div>
            ) : (
              <button disabled={busy} onClick={onRetry}>
                {busy ? 'Preparing secure code…' : 'Try again'}
              </button>
            )}
            {error && <p role="alert">{error}</p>}
            <button className="secondary" onClick={onDismiss}>
              Cancel
            </button>
          </>
        )}
      </section>
    </ModalDialog>
  );
}
