# ADR 0115: Chunked, authenticated clip encryption

- Status: Accepted (2026-10-12), audit findings V30 and V60

## Context

A clip was encrypted as one AES-GCM message. The web player read the whole ciphertext into one buffer,
decrypted it into a second, and built a Blob from that (about three times the clip in memory); recording and
the checksum did the same. On Android, Conscrypt's AES-GCM holds the whole message before it releases output,
and playback wrote a ciphertext file and then a plaintext copy. On older phones, a long clip could run out of
memory or storage.

## Decision

New clips use a chunked format, "BCLIP1", identical on the web viewer and the Android app:

- A 16-byte header: `BCLIP1`, two zero bytes, the chunk size (uint32, big endian, 1 MiB today; a power of two
  from 4 KiB to 16 MiB is accepted), four zero bytes.
- Then chunks of AES-256-GCM output (plaintext piece plus a 16-byte tag). Every chunk holds exactly the chunk
  size except the last, which holds 1 to chunk-size bytes (or none for an empty clip).
- Each chunk's nonce is the first 7 bytes of the clip IV, the chunk index (uint32) and a last-chunk flag byte.
  The header is the additional authenticated data of every chunk. A truncated file, swapped chunks, extra bytes
  or an altered header therefore fail to authenticate.
- The per-clip key and 12-byte IV are exchanged with the server exactly as before, so the backend, its
  storage and the share-link flow need no change. Readers recognise the format by the magic bytes; a clip
  recorded earlier is still one AES-GCM message and still plays.
- The checksum stays a plain SHA-256 of the whole encrypted file. The web viewer hashes incrementally
  (WebCrypto can only hash a whole buffer), Android streams the digest.
- Thumbnails stay single messages; they are small.

## Result

- Recording on the web encrypts one chunk at a time and hashes as it goes. Playback reads the download as a
  stream and decrypts each chunk when it completes, so memory stays near the size of the finished clip
  instead of about three times it.
- Android encrypts with two chunks in memory and decrypts the download straight into the playback file, with
  no second whole copy on disk.
- A known-answer test (the encrypted-file digest for a fixed key, IV and input) is asserted by both
  implementations, so they cannot drift apart.

## Not done

- Playback still waits for the whole download before the video starts. Starting early would need Media Source
  Extensions or a progressive container; the chunked format makes that possible later.
- The 250 MB per-clip limit is unchanged.
- An Android app older than this release cannot play clips recorded in the new format; the web viewer
  updates itself on the next visit, and Android needs the new build (0.1.0-alpha10).
