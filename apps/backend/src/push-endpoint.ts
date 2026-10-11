/**
 * Web Push endpoints are chosen by the browser, but this server makes the
 * request to them. An account holder could otherwise register any HTTPS URL
 * and make the server call it (server-side request forgery). Only the push
 * services that browsers use are accepted.
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge, Opera, Brave and other Chromium browsers
  'push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari
  'notify.windows.com', // Windows Notification Service (legacy Edge)
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}
