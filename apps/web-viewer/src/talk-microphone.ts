/** The microphone this device uses for Talk ('' = system default). */
const KEY = 'beacon.talk.microphone.v1';

export function loadTalkMicrophone(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveTalkMicrophone(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(KEY, deviceId);
    else localStorage.removeItem(KEY);
  } catch {
    // The choice lasts for this session only.
  }
}

const TALK_PROCESSING = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
};

/** Opens the chosen Talk microphone, falling back to the system default if
 * it has been unplugged since it was chosen. */
export async function openTalkMicrophone(): Promise<MediaStream> {
  const deviceId = loadTalkMicrophone();
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId
        ? { ...TALK_PROCESSING, deviceId: { exact: deviceId } }
        : TALK_PROCESSING,
      video: false,
    });
  } catch (error) {
    if (
      deviceId &&
      error instanceof DOMException &&
      (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')
    )
      return navigator.mediaDevices.getUserMedia({
        audio: TALK_PROCESSING,
        video: false,
      });
    throw error;
  }
}

export interface Microphone {
  deviceId: string;
  label: string;
}

/** Lists microphones. Their names need microphone permission, so pass
 * `askPermission` only after the person chose to see them. */
export async function listMicrophones(
  askPermission: boolean,
): Promise<Microphone[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  if (askPermission) {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((track) => track.stop());
  }
  return (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === 'audioinput' && device.deviceId)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}
