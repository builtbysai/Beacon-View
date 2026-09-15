import { randomBytes } from 'node:crypto';
import { mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import webPush from 'web-push';

const outputArgument = process.argv[2];
const subject = process.argv[3] ?? 'https://beacon.builtbysai.com';

if (!outputArgument || !isAbsolute(outputArgument)) {
  throw new Error(
    'Pass an absolute output path outside the repository as the first argument.',
  );
}

const repositoryRoot = await realpath(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
);
const outputPath = resolve(outputArgument);
const repositoryRelativePath = relative(repositoryRoot, outputPath);

if (
  repositoryRelativePath === '' ||
  (!repositoryRelativePath.startsWith('..') &&
    !isAbsolute(repositoryRelativePath))
) {
  throw new Error(
    'Refusing to write notification secrets inside the repository.',
  );
}

const subjectUrl = new URL(subject);
if (!['https:', 'mailto:'].includes(subjectUrl.protocol)) {
  throw new Error('The VAPID subject must use https: or mailto:.');
}

const vapid = webPush.generateVAPIDKeys();
const secretFile = [
  '# Generated notification secrets. Keep outside Git and copy only to the secured runtime environment.',
  `NOTIFICATION_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}`,
  `NOTIFICATION_FINGERPRINT_KEY=${randomBytes(32).toString('base64url')}`,
  `WEB_PUSH_VAPID_PUBLIC_KEY=${vapid.publicKey}`,
  `WEB_PUSH_VAPID_PRIVATE_KEY=${vapid.privateKey}`,
  `WEB_PUSH_VAPID_SUBJECT=${subjectUrl.toString()}`,
  '',
].join('\n');

await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
const handle = await open(outputPath, 'wx', 0o600);

try {
  await handle.writeFile(secretFile, { encoding: 'utf8' });
} finally {
  await handle.close();
}

console.log(`Notification secrets written to ${outputPath}`);
