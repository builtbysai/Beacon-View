import { afterEach, expect, it, vi } from 'vitest';

import { encryptClip, sha256Hex } from './recording-capture';
import { loadRecordingForPlayback } from './recording-playback';

afterEach(() => vi.unstubAllGlobals());

it('checks ciphertext integrity and decrypts an authorized clip locally', async () => {
  const encrypted = await encryptClip(
    new Blob(['private clip'], { type: 'video/webm' }),
  );
  const checksum = await sha256Hex(encrypted.blob);
  const response = new Response(await encrypted.blob.arrayBuffer(), {
    headers: {
      'X-Beacon-Recording-Bytes': String(encrypted.blob.size),
      'X-Beacon-Recording-Checksum': checksum,
      'X-Beacon-Recording-Key': encrypted.dataKey,
      'X-Beacon-Recording-IV': encrypted.iv,
      'X-Beacon-Recording-Mime': 'video/webm',
    },
  });
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);

  const clip = await loadRecordingForPlayback('recording-one');
  expect(clip.type).toBe('video/webm');
  expect(await clip.text()).toBe('private clip');
  expect(fetch).toHaveBeenCalledWith(
    '/api/recordings/recording-one/playback',
    expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
  );
});

it('rejects altered ciphertext before playback', async () => {
  const encrypted = await encryptClip(new Blob(['private clip']));
  const response = new Response(await encrypted.blob.arrayBuffer(), {
    headers: {
      'X-Beacon-Recording-Bytes': String(encrypted.blob.size),
      'X-Beacon-Recording-Checksum': '0'.repeat(64),
      'X-Beacon-Recording-Key': encrypted.dataKey,
      'X-Beacon-Recording-IV': encrypted.iv,
      'X-Beacon-Recording-Mime': 'video/webm',
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  await expect(loadRecordingForPlayback('recording-one')).rejects.toThrow(
    'integrity check',
  );
});
