import { useEffect, useRef, useState } from 'react';

import { pairingCodeFromScan } from './app-navigation';

export function PairingCodeScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState(
    'Point your camera at a Beacon pairing QR code.',
  );

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (disposed || !videoRef.current) return;
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, _error, scanner) => {
            if (!result || disposed) return;
            const code = pairingCodeFromScan(result.getText());
            if (!code) {
              setMessage(
                'This is not a Beacon pairing code. Try another QR code.',
              );
              return;
            }
            scanner.stop();
            onCode(code);
          },
        );
        stop = () => controls.stop();
        if (disposed) stop();
      } catch {
        if (!disposed)
          setMessage(
            'Could not open the scanner. Enter the code above instead.',
          );
      }
    })();
    return () => {
      disposed = true;
      stop?.();
    };
  }, [onCode]);

  return (
    <div className="pairing-scanner">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Pairing QR code scanner"
      />
      <p role="status">{message}</p>
      <button className="btn secondary" type="button" onClick={onClose}>
        Close scanner
      </button>
    </div>
  );
}
