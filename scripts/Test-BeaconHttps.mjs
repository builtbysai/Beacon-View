import { readFileSync } from 'node:fs';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';

const [url, certificatePath, expectedHost] = process.argv.slice(2);
if (!url || !certificatePath || !expectedHost) {
  throw new Error('URL, certificate path, and expected host are required');
}
const ca = readFileSync(certificatePath);

await new Promise((resolve, reject) => {
  const request = https.get(
    url,
    { ca, rejectUnauthorized: true },
    (response) => {
      const peer = response.socket.getPeerCertificate();
      if (!peer.raw) {
        reject(new Error('HTTPS peer certificate was unavailable'));
        return;
      }
      const certificate = new X509Certificate(peer.raw);
      const certificateNames = certificate.subjectAltName ?? '';
      const expectedEntry = isIP(expectedHost)
        ? `IP Address:${expectedHost}`
        : `DNS:${expectedHost}`;
      if (!certificateNames.includes(expectedEntry)) {
        reject(
          new Error(
            `Server certificate does not contain ${expectedHost}: ${certificateNames}`,
          ),
        );
        return;
      }
      response.resume();
      if ((response.statusCode ?? 500) >= 400) {
        reject(new Error(`HTTPS returned ${response.statusCode}`));
        return;
      }
      response.on('end', resolve);
    },
  );
  request.setTimeout(5_000, () => request.destroy(new Error('HTTPS timeout')));
  request.on('error', reject);
});
console.log(
  `Trusted HTTPS and certificate host validation passed for ${expectedHost}`,
);
