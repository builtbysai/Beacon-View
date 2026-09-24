import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ClipRecorder,
  encryptClip,
  formatClipTimer,
  pickRecorderMimeType,
  recordingContainerType,
  sha256Hex,
  uploadClipToDrive,
} from './recording-capture';

class FakeMediaRecorder {
  static supportedTypes = new Set<string>();
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(type);
  }

  mimeType: string;
  state: 'inactive' | 'recording' = 'inactive';
  failOnStop: Error | null = null;
  #listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(
    readonly stream: MediaStream,
    options: { mimeType: string },
  ) {
    this.mimeType = options.mimeType;
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    if (this.failOnStop) {
      this.#emit('error', { error: this.failOnStop });
      return;
    }
    this.#emit('dataavailable', {
      data: new Blob(['clip-bytes'], { type: this.mimeType }),
    });
    this.#emit('stop', {});
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeMediaRecorder.instances = [];
});

describe('pickRecorderMimeType', () => {
  it('returns the first supported candidate', () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    expect(pickRecorderMimeType()).toBe('video/webm');
  });

  it('returns null when nothing is supported', () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    FakeMediaRecorder.supportedTypes = new Set();
    expect(pickRecorderMimeType()).toBeNull();
  });

  it('returns null when MediaRecorder does not exist at all', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickRecorderMimeType()).toBeNull();
  });
});

describe('formatClipTimer', () => {
  it('formats elapsed milliseconds as minutes:seconds', () => {
    expect(formatClipTimer(0)).toBe('0:00');
    expect(formatClipTimer(9_000)).toBe('0:09');
    expect(formatClipTimer(65_000)).toBe('1:05');
    expect(formatClipTimer(600_000)).toBe('10:00');
  });
});

describe('recordingContainerType', () => {
  it('narrows a codec-qualified mime type to its container', () => {
    expect(recordingContainerType('video/webm;codecs=vp9,opus')).toBe(
      'video/webm',
    );
    expect(recordingContainerType('video/mp4;codecs=avc1')).toBe('video/mp4');
    expect(recordingContainerType('video/mp4')).toBe('video/mp4');
  });
});

describe('sha256Hex', () => {
  it('hashes empty content to the well-known SHA-256 digest', async () => {
    expect(await sha256Hex(new Blob([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('encryptClip', () => {
  it('uses a fresh AES-GCM key and IV to produce an opaque Drive payload', async () => {
    const source = new Blob(['private clip'], { type: 'video/webm' });
    const encrypted = await encryptClip(source);

    expect(encrypted.blob.type).toBe('application/octet-stream');
    expect(await encrypted.blob.text()).not.toBe('private clip');
    expect(encrypted.iv).toHaveLength(16);
    expect(encrypted.dataKey).toHaveLength(43);

    const decode = (value: string) =>
      Uint8Array.from(
        atob(value.replaceAll('-', '+').replaceAll('_', '/')),
        (c) => c.charCodeAt(0),
      );
    const key = await crypto.subtle.importKey(
      'raw',
      decode(encrypted.dataKey),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(encrypted.iv) },
      key,
      new Uint8Array(await encrypted.blob.arrayBuffer()),
    );
    expect(new TextDecoder().decode(plaintext)).toBe('private clip');
  });
});

describe('uploadClipToDrive', () => {
  it('PUTs the blob and returns the Drive file id', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'drive-file-42' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const blob = new Blob(['clip'], { type: 'video/webm' });
    await expect(
      uploadClipToDrive('https://example.com/upload', blob),
    ).resolves.toBe('drive-file-42');

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.com/upload');
    expect(options?.method).toBe('PUT');
    expect(options?.body).toBe(blob);
  });

  it('rejects when Drive returns a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );
    await expect(
      uploadClipToDrive('https://example.com/upload', new Blob(['x'])),
    ).rejects.toThrow('Upload to Google Drive failed');
  });

  it('rejects when Drive omits a file id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}))),
    );
    await expect(
      uploadClipToDrive('https://example.com/upload', new Blob(['x'])),
    ).rejects.toThrow('did not return a file id');
  });
});

describe('ClipRecorder', () => {
  it('assembles the chunks recorded between start and stop, and reports elapsed duration', async () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    const stream = {} as MediaStream;
    const recorder = new ClipRecorder(stream, 'video/webm');
    expect(recorder.mimeType).toBe('video/webm');

    recorder.start();
    const fake = FakeMediaRecorder.instances[0]!;
    expect(fake.state).toBe('recording');

    const stopped = recorder.stop();
    fake.stop();
    const { blob, durationMs } = await stopped;
    expect(await blob.text()).toBe('clip-bytes');
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects stop() when the underlying recorder reports an error', async () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    const recorder = new ClipRecorder({} as MediaStream, 'video/webm');
    recorder.start();
    const fake = FakeMediaRecorder.instances[0]!;
    fake.failOnStop = new Error('device disconnected');
    await expect(recorder.stop()).rejects.toThrow('device disconnected');
  });
});
