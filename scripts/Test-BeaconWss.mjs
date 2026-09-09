import { readFileSync } from 'node:fs';
import WebSocket from '../apps/backend/node_modules/ws/index.js';

const [url, certificatePath, origin] = process.argv.slice(2);
if (!url || !certificatePath || !origin) {
  throw new Error('WSS URL, certificate path, and origin are required');
}
const socket = new WebSocket(url, {
  ca: readFileSync(certificatePath),
  origin,
  rejectUnauthorized: true,
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WSS timeout')), 5_000);
  socket.once('close', (code) => {
    clearTimeout(timer);
    if (code !== 4003) {
      reject(new Error(`Unexpected WSS close code ${code}`));
      return;
    }
    resolve();
  });
  socket.once('error', reject);
});
console.log('Trusted WSS upgrade reached the authorized rejection boundary');
