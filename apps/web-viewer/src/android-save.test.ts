import { afterEach, describe, expect, it } from 'vitest';

import { saveBlobToAndroid } from './android-shell';
import { downloadBlob } from './browser-download';

/** A fake app that answers every message and collects the file the page hands over. */
function installApp(options: { failAt?: string } = {}) {
  const messages: Array<Record<string, unknown>> = [];
  const bytes: number[] = [];
  let listener: ((event: { data: unknown }) => void) | null = null;
  window.BeaconAndroid = {
    addEventListener: (_type, next) => {
      listener = next;
    },
    postMessage: (raw: string) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      messages.push(message);
      const failed = message.type === options.failAt;
      let data: Record<string, unknown> = {};
      if (message.type === 'saveFileStart')
        data = { token: '123e4567-e89b-12d3-a456-426614174000' };
      if (message.type === 'saveFileChunk' && !failed)
        bytes.push(...Buffer.from(String(message.data), 'base64'));
      if (message.type === 'saveFileEnd') data = { name: 'x' };
      queueMicrotask(() =>
        listener?.({
          data: JSON.stringify(
            failed
              ? { error: 'no', id: message.id, ok: false }
              : { data, id: message.id, ok: true },
          ),
        }),
      );
    },
  };
  return { bytes, messages };
}

afterEach(() => {
  delete window.BeaconAndroid;
});

describe('saving a file through the Android app', () => {
  it(
    'hands the file over in pieces that add up to the original',
    { timeout: 60_000 },
    async () => {
      const app = installApp();
      const original = new Uint8Array(250_000).map((_, index) => index % 251);
      await saveBlobToAndroid(
        new Blob([original], { type: 'video/mp4' }),
        'clip.mp4',
      );
      expect(app.messages[0]).toMatchObject({
        mime: 'video/mp4',
        name: 'clip.mp4',
        type: 'saveFileStart',
      });
      const chunks = app.messages.filter(
        (message) => message.type === 'saveFileChunk',
      );
      expect(chunks.length).toBe(3);
      for (const chunk of chunks)
        expect(String(chunk.data).length).toBeLessThanOrEqual(131_072);
      expect(app.messages.at(-1)?.type).toBe('saveFileEnd');
      expect(Uint8Array.from(app.bytes)).toEqual(original);
    },
  );

  it('saves an empty file without sending any piece', async () => {
    const app = installApp();
    await saveBlobToAndroid(new Blob([]), 'empty.txt');
    expect(app.messages.map((message) => message.type)).toEqual([
      'saveFileStart',
      'saveFileEnd',
    ]);
  });

  it('stops and reports when the app refuses a piece', async () => {
    const app = installApp({ failAt: 'saveFileChunk' });
    await expect(saveBlobToAndroid(new Blob(['abc']), 'a.txt')).rejects.toThrow(
      'no',
    );
    expect(app.messages.some((message) => message.type === 'saveFileEnd')).toBe(
      false,
    );
  });

  it('is what a download does inside the app, instead of a browser link', async () => {
    const app = installApp();
    downloadBlob(new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.messages.map((message) => message.type)).toEqual([
      'saveFileStart',
      'saveFileChunk',
      'saveFileEnd',
    ]);
    expect(Buffer.from(app.bytes).toString()).toBe('hello');
  });
});
