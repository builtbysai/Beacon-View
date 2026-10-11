// Signs update feed files so installed apps can tell a real release from one
// planted on the server (ADR 0110).
//   BEACON_UPDATE_SIGNING_KEY=<private-key-file> node scripts/sign-update-feed.mjs latest.yml [latest-linux.yml ...]
// Writes <file>.sig (base64 Ed25519 signature of the file's exact bytes) next to each.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const keyFile = process.env.BEACON_UPDATE_SIGNING_KEY;
const files = process.argv.slice(2);
if (!keyFile || files.length === 0) {
  console.error(
    'Usage: BEACON_UPDATE_SIGNING_KEY=<private-key-file> node scripts/sign-update-feed.mjs <latest*.yml> ...',
  );
  process.exit(1);
}
const key = createPrivateKey(readFileSync(keyFile));
for (const file of files) {
  const signature = sign(null, readFileSync(file), key).toString('base64');
  writeFileSync(`${file}.sig`, `${signature}\n`);
  console.log(`signed ${file}`);
}
