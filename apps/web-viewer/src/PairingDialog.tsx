import { QRCodeSVG } from 'qrcode.react';
import { ModalDialog } from './ModalDialog';
import { pairingLink } from './app-navigation';
import type { PairingLifecycle } from './lifecycle';
import { Icon } from './Icon';
import './PairingDialog.css';

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
            <span className="icon" aria-hidden="true">
              <Icon name="check" />
            </span>
            <h2 id="pair-title">Camera connected</h2>
            <p>Taking you to Cameras...</p>
          </div>
        ) : (
          <>
            <div className="pair-mh">
              <div className="pair-eyebrow">
                {reconnecting ? 'Reconnect' : 'Add device'}
              </div>
              <h2 id="pair-title">
                {reconnecting ? 'Reconnect camera' : 'Pair another device'}
              </h2>
              <p>
                {reconnecting
                  ? 'On the disconnected Android camera, scan this code to restore its existing settings.'
                  : 'Scan the QR code with Beacon on Android, or share the one-time setup link.'}
              </p>
            </div>

            {code ? (
              <div className="pairbody" role="status">
                <div className="pair-qr">
                  <QRCodeSVG
                    aria-label="Beacon pairing QR code"
                    bgColor="#ffffff"
                    fgColor="#101820"
                    level="M"
                    marginSize={0}
                    size={180}
                    title="Scan with Beacon on Android"
                    value={pairingLink(code)}
                  />
                </div>
                <div className="pair-code">
                  <h3>One-time pairing code</h3>
                  <div className="big">{code}</div>
                  <p>Expires in 10 minutes</p>
                  <button
                    className="btn secondary"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(pairingLink(code))
                        .catch(onCopyError);
                    }}
                  >
                    Copy setup link
                  </button>
                </div>
              </div>
            ) : error ? (
              <div className="pair-error" role="alert">
                <p>
                  <strong>Couldn't prepare pairing code</strong>
                </p>
                <p>{error}</p>
                <div className="pair-modalfoot">
                  <button className="btn secondary" onClick={onDismiss}>
                    Cancel
                  </button>
                  <button className="btn primary" onClick={onRetry}>
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <div className="pair-loading" aria-busy={busy}>
                <p>Preparing...</p>
              </div>
            )}

            {!error && (
              <div className="pair-modalfoot">
                <button className="btn secondary" onClick={onDismiss}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </ModalDialog>
  );
}
