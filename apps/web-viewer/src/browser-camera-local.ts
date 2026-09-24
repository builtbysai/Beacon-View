const LOCAL_DEVICE_KEY = 'beacon_browser_camera_device_id';

export function rememberLocalBrowserDevice(id: string): void {
  try {
    localStorage.setItem(LOCAL_DEVICE_KEY, id);
  } catch {
    // Camera mode remains usable without a saved resume shortcut.
  }
}

export function isLocalBrowserCamera(deviceId: string): boolean {
  try {
    return localStorage.getItem(LOCAL_DEVICE_KEY) === deviceId;
  } catch {
    return false;
  }
}
