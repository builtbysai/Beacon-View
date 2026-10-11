// Creates the Ed25519 key pair that signs desktop update feeds (ADR 0110).
//   node scripts/generate-update-key.mjs <private-key-file>
// The private key is written to the file you name (keep it OUTSIDE the repository
// and back it up: without it no update can be published, and anyone who has it can
// publish updates). The public key is printed; it is embedded in src/update-signature.ts.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error(
    'Usage: node scripts/generate-update-key.mjs <private-key-file>',
  );
  process.exit(1);
}
if (existsSync(target)) {
  console.error(
    `${target} already exists; refusing to overwrite a signing key.`,
  );
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(target, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
  mode: 0o600,
});
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
console.log(`Public key (base64): ${raw.toString('base64')}`);
