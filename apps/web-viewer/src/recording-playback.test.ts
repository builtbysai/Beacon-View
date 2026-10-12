import { afterEach, expect, it, vi } from 'vitest';

import { encryptClipChunked } from './clip-crypto';
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

function pieces(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

async function chunkedResponse(
  text: string,
  overrides: { checksum?: string; tamper?: boolean } = {},
) {
  const sealed = await encryptClipChunked(
    new Blob([text], { type: 'video/webm' }),
    { chunkBytes: 4096 },
  );
  const bytes = new Uint8Array(await sealed.blob.arrayBuffer());
  if (overrides.tamper) bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 1;
  return {
    headers: {
      'X-Beacon-Recording-Bytes': String(bytes.length),
      'X-Beacon-Recording-Checksum': overrides.checksum ?? sealed.sha256,
      'X-Beacon-Recording-IV': sealed.iv,
      'X-Beacon-Recording-Key': sealed.dataKey,
      'X-Beacon-Recording-Mime': 'video/webm',
    },
    stream: pieces(bytes, 1500),
  };
}

it('decrypts a chunked clip as it streams in', async () => {
  const text = 'frame data '.repeat(1500);
  const { headers, stream } = await chunkedResponse(text);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(stream, { headers })),
  );
  const clip = await loadRecordingForPlayback('recording-chunked');
  expect(clip.type).toBe('video/webm');
  expect(await clip.text()).toBe(text);
});

it('rejects a chunked clip whose bytes or checksum were altered', async () => {
  const altered = await chunkedResponse('frame data '.repeat(1500), {
    tamper: true,
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(altered.stream, { headers: altered.headers }),
      ),
  );
  await expect(loadRecordingForPlayback('r')).rejects.toThrow(
    'integrity check',
  );

  const wrongSum = await chunkedResponse('frame data '.repeat(1500), {
    checksum: '1'.repeat(64),
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(wrongSum.stream, { headers: wrongSum.headers }),
      ),
  );
  await expect(loadRecordingForPlayback('r')).rejects.toThrow(
    'integrity check',
  );
});
