import { useEffect, useState } from 'react';

import {
  type AndroidCameraState,
  androidApp,
  androidAppVersion,
  isAndroidApp,
  onAndroidCameraState,
} from './android-shell';

/** What the Android app says about itself and the phone's own camera. Inside a browser it is always `inApp: false`. */
export function useAndroidApp(): {
  camera: AndroidCameraState | null;
  inApp: boolean;
  version: string | null;
} {
  const inApp = isAndroidApp();
  const [camera, setCamera] = useState<AndroidCameraState | null>(null);
  const [version, setVersion] = useState<string | null>(() =>
    inApp ? androidAppVersion() : null,
  );
  useEffect(() => {
    if (!inApp) return;
    let active = true;
    void androidApp.hello().then(
      (hello) => {
        if (!active) return;
        setCamera(hello.camera);
        setVersion(hello.version);
      },
      () => undefined,
    );
    const stop = onAndroidCameraState((state) => active && setCamera(state));
    return () => {
      active = false;
      stop();
    };
  }, [inApp]);
  return { camera, inApp, version };
}
