/**
 * What people read when something goes wrong (ADR 0087).
 *
 * The server's `error` strings are stable identifiers: the Android app
 * matches on them, and tests and logs use them. So the server keeps
 * them, and each client turns them into plain words. This table is the
 * web app's copy. Every message says what happened and, where there is
 * one, what to do next. It never blames the person, and it never shows
 * internal terms (CSRF, envelope, pagination).
 */

const TRY_AGAIN = 'Try again in a moment.';
const RELOAD = 'Reload the page and try again.';
const ASK_OWNER = 'Ask the household owner if you need this.';
const WAIT = 'Wait a minute, then try again.';

const SERVER_MESSAGES: Record<string, string> = {
  // Signing in and accounts
  'Authentication required': 'Please sign in again to continue.',
  'CSRF validation failed': `Your session needs refreshing. ${RELOAD}`,
  'Invalid email or password':
    'That email and password don’t match. Check them and try again.',
  'Invalid sign-in request': 'Enter your email and password to sign in.',
  'Invalid registration details':
    'Enter a valid email and a password of at least 12 characters.',
  'Unable to create account':
    'That account couldn’t be created. If you already have one, sign in instead.',
  'Invalid password': 'Use a password of 12 to 128 characters.',
  'Incorrect password': 'That password isn’t right. Try again.',
  'Invalid reauthentication': 'Enter your password to confirm.',
  'Sign in again to confirm this action':
    'For your security, confirm your password to continue.',
  'Sign in again, then retry account deletion within 10 minutes':
    'For your security, confirm your password, then delete the account within 10 minutes.',
  'Account deletion was not confirmed':
    'Type the confirmation exactly as shown to delete your account.',
  'Account not found': 'We couldn’t find that account.',
  'This account already has a password':
    'This account already has a password. Change it from Settings instead.',
  'Google sign-in is unavailable':
    'Google sign-in isn’t available on this Beacon server. Use your email and password.',
  'Google sign-in could not be completed':
    'Google sign-in didn’t finish. Try again.',
  'Session not found':
    'That device is already signed out. Refresh the list to see the latest.',

  // Email verification and password reset
  'Email verification is unavailable':
    'Email verification isn’t available on this Beacon server.',
  'The verification email could not be sent': `The verification email couldn’t be sent. ${TRY_AGAIN}`,
  'Invalid email verification':
    'That verification link isn’t valid. Request a new one from Settings.',
  'Invalid or expired verification link':
    'That verification link has expired. Request a new one from Settings.',
  'Password reset is unavailable':
    'Password reset isn’t available on this Beacon server.',
  'Invalid password reset request': 'Enter the email for your account.',
  'Invalid password reset': 'Choose a new password of at least 12 characters.',
  'Invalid or expired reset link':
    'That reset link has expired. Request a new one.',

  // Permissions and households
  'Household owner access required': `Only the household owner can do this. ${ASK_OWNER}`,
  'Household administrator access required': `Only the household owner or an admin can do this. ${ASK_OWNER}`,
  'Household member access required':
    'Only household members can do this. Guests have view-only access.',
  'Household unavailable':
    'That household is no longer available. You may have been removed from it.',
  'Invalid household selection':
    'That household isn’t available. Refresh and choose again.',
  'Household member unavailable':
    'That person is no longer in this household. Refresh to see the latest.',
  'Revoke this member first before removing them':
    'Revoke this person’s access first, then remove them.',
  'You cannot invite that household role':
    'You can’t invite someone with that role. Choose a different access level.',
  'Invalid household invitation':
    'Enter a valid email and access level for the invitation.',
  'Invitation unavailable':
    'That invitation has expired or was already used. Ask for a new one.',
  'Invitation email could not be delivered': `The invitation was created, but the email couldn’t be sent. Copy the invite link to share it another way.`,
  'Too many invitation attempts': `Too many invitation attempts. ${WAIT}`,
  'Too many invitation changes': `Too many invitation changes. ${WAIT}`,
  'Verify your email address to sign in':
    'Check your email: we sent a new verification link. Open it, then sign in.',
  'Verify your email address before inviting people':
    'Verify your email address first (Settings → Account), then send the invitation.',
  'Choose which cameras a viewer can see':
    'Choose which cameras this person can see.',
  'Choose cameras in this household':
    'One of the cameras you picked isn’t in this household. Refresh and try again.',
  'Invalid camera grants': 'Choose at least one camera and an access level.',

  // Cameras and devices
  'Camera not found':
    'That camera is no longer available. It may have been removed.',
  'Camera unavailable':
    'That camera is no longer available. It may have been removed.',
  'Camera is unavailable':
    'That camera can’t do this right now. Check that it’s online.',
  'Camera is offline':
    'This camera is offline. Check that its device is on and connected to the internet.',
  'Device not found':
    'That device is no longer available. It may have been removed.',
  'Device is offline; source switch will be available when it reconnects':
    'This device is offline. You can switch cameras once it reconnects.',
  'You cannot switch this camera': `Only the person who set up this camera can switch it. ${ASK_OWNER}`,
  'You can only remove a camera you paired':
    'You can only remove cameras you set up. Ask the household owner to remove this one.',
  'You cannot change privacy mode for this camera': `You can’t pause this camera. ${ASK_OWNER}`,
  'Privacy mode currently requires an Android camera device':
    'Pausing is only available for Android cameras for now.',
  'Invalid privacy mode request': `That change didn’t go through. ${RELOAD}`,
  'Pairing code expired or invalid':
    'That pairing code has expired or isn’t valid. Create a new one and try again.',
  'Pairing code not found':
    'That pairing code wasn’t found. Check it, or create a new one.',
  'Unable to pair device': `That device couldn’t be paired. Create a new pairing code and try again.`,
  'Invalid browser camera details': 'Give this camera a name, then try again.',
  'Request origin required': `This page couldn’t be verified. ${RELOAD}`,
  'Invalid camera use': 'Choose how this camera is used, then try again.',
  'Invalid motion settings':
    'Some motion settings weren’t accepted. Check them and save again.',
  'Invalid motion retention setting':
    'Choose how long to keep motion history, then save again.',
  'Motion event unavailable': 'That motion event is no longer available.',
  'Diagnostics unavailable': `Diagnostics couldn’t be loaded. ${TRY_AGAIN}`,

  // Recordings and sharing
  'Encrypted recording storage is unavailable':
    'Recording isn’t set up on this Beacon server yet.',
  'Connect Google Drive for recordings first':
    'Connect Google Drive to save recordings.',
  'Google Drive is not connected': 'Google Drive isn’t connected.',
  'Google Drive is unavailable':
    'Google Drive isn’t available on this Beacon server.',
  'Invalid Google Drive request': `That Google Drive request didn’t go through. ${RELOAD}`,
  'Recording unavailable':
    'That clip is no longer available. It may have been deleted.',
  'Recording request unavailable':
    'That recording has already finished or was cancelled.',
  'Recording upload unavailable':
    'That recording can no longer be uploaded. Record a new clip.',
  'Recording state changed':
    'That clip changed in the meantime. Refresh to see the latest.',
  'Thumbnail state changed':
    'That clip changed in the meantime. Refresh to see the latest.',
  'Recording cannot be deleted while an upload is active':
    'This clip is still uploading. Delete it once the upload finishes.',
  'Recording could not be deleted from Google Drive': `The clip couldn’t be deleted from Google Drive. ${TRY_AGAIN}`,
  'Recording playback is temporarily unavailable': `The clip couldn’t be loaded. ${TRY_AGAIN}`,
  'Recording upload is temporarily unavailable': `The clip couldn’t be uploaded right now. ${TRY_AGAIN}`,
  'Uploaded recording could not be verified':
    'Google Drive didn’t confirm the clip. Retry the upload.',
  'Too many playback requests': `Too many clips opened in a short time. ${WAIT}`,
  'Only an available clip can be shared':
    'This clip can be shared once it finishes uploading.',
  'Share link unavailable': 'That share link has expired or was turned off.',
  'Link unavailable': 'This link has expired or was turned off.',
  'Invalid share link request': 'Choose how long the link should last.',

  // Guest links
  'Guest link required': 'Open the full guest link you were sent.',
  'Guest link unavailable':
    'This guest link has expired or was turned off. Ask for a new one.',
  'This link is not valid': 'This link isn’t valid. Ask for a new one.',
  'This link is no longer valid':
    'This link has expired or was turned off. Ask for a new one.',
  'Invalid guest link': 'Choose cameras and how long the link should last.',
  'None of those cameras are available to share':
    'Those cameras can’t be shared right now. Refresh and choose again.',
  'Too many guest links created': `Too many guest links in a short time. ${WAIT}`,

  // Notifications
  'Notifications are not configured':
    'Notifications aren’t set up on this Beacon server.',
  'Web Push is unavailable':
    'Browser notifications aren’t available on this Beacon server.',
  'Web notifications are unavailable':
    'Browser notifications aren’t available on this Beacon server.',
  'Android notifications are unavailable':
    'Android notifications aren’t available on this Beacon server.',
  'Invalid notification subscription': `Notifications couldn’t be turned on in this browser. ${RELOAD}`,
  'Subscription not found': 'Notifications are already off on this device.',
  'Invalid notification preference': `That notification setting wasn’t saved. ${RELOAD}`,
  'Too many notification changes': `Too many notification changes. ${WAIT}`,

  // Contact
  'Contact delivery is unavailable':
    'Messages can’t be sent from this Beacon server right now.',
  'Invalid contact message': 'Add your email and a message, then send again.',
  'Please try again later': `That didn’t go through. ${TRY_AGAIN}`,

  // Rate limits
  'Too many requests': `Too many attempts. ${WAIT}`,
  'Too many attempts': `Too many attempts. ${WAIT}`,
};

/** Server strings that identify a situation the app handles itself; they
 * become codes so screens never compare display text. */
const SERVER_CODES: Record<string, string> = {
  googleAccountExists: 'google_account_exists',
};

/** Validation failures are bugs or stale pages, not something to fix in a
 * form. When no specific wording exists, they get this. */
const GENERIC_INVALID = `That didn’t go through. ${RELOAD}`;

export interface FriendlyServerError {
  code: string | undefined;
  message: string;
}

/** Plain words for a failed API response. */
export function friendlyServerError(
  status: number,
  serverMessage: string | undefined,
  serverCode: string | undefined,
): FriendlyServerError {
  const code =
    serverCode ?? (serverMessage ? SERVER_CODES[serverMessage] : undefined);
  const known = serverMessage ? SERVER_MESSAGES[serverMessage] : undefined;
  if (known) return { code, message: known };
  if (serverMessage && code && SERVER_CODES[serverMessage])
    return { code, message: statusMessage(status) };
  if (serverMessage && /^Invalid\b/u.test(serverMessage))
    return { code, message: GENERIC_INVALID };
  // Server text already written for people (newer messages, ADR 0086).
  if (serverMessage && /[.!?]$/u.test(serverMessage))
    return { code, message: serverMessage };
  return { code, message: statusMessage(status) };
}

/** Wording by HTTP status when nothing more specific is known. */
export function statusMessage(status: number): string {
  if (status === 401) return 'Please sign in again to continue.';
  if (status === 403) return `You don’t have access to do that. ${ASK_OWNER}`;
  if (status === 404)
    return 'That’s no longer available. It may have been removed.';
  if (status === 409)
    return 'That changed in the meantime. Refresh and try again.';
  if (status === 413) return 'That’s too large to send.';
  if (status === 429) return `Too many attempts. ${WAIT}`;
  if (status >= 500) return `Beacon is having trouble right now. ${TRY_AGAIN}`;
  return GENERIC_INVALID;
}

export type MediaDevice = 'camera' | 'microphone' | 'camera and microphone';

/** Plain words for a camera/microphone failure (getUserMedia). */
export function mediaErrorMessage(error: unknown, device: MediaDevice): string {
  const name = error instanceof DOMException ? error.name : '';
  const it = device === 'camera and microphone' ? 'them' : 'it';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Beacon doesn’t have permission to use the ${device}. Allow access in your browser’s site settings (the icon next to the address), then try again.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${device} was found. Connect one, or choose a different one, and try again.`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `The ${device} is being used by another app. Close that app (video calls are a common cause), then try again.`;
    case 'AbortError':
      return `The ${device} stopped while starting. Try again.`;
    default:
      return `The ${device} couldn’t be started. Check that ${it} is connected, then try again.`;
  }
}

/** Errors the browser raises with technical wording; never show those. */
function browserErrorMessage(error: Error | DOMException): string | null {
  if (error instanceof DOMException) {
    // Not necessarily the person cancelling: browsers also abort on
    // service failures (e.g. push registration).
    if (error.name === 'AbortError') return 'That didn’t finish. Try again.';
    if (error.name === 'TimeoutError')
      return `That took too long. ${TRY_AGAIN}`;
    if (error.name === 'QuotaExceededError')
      return 'This browser is out of storage space for Beacon. Free some space, then try again.';
    if (error.name === 'NotAllowedError')
      return 'Your browser blocked that. Check its site permissions for Beacon, then try again.';
    if (error.name === 'NotSupportedError')
      return 'This browser doesn’t support that. Try a current version of Chrome, Edge, Safari, or Firefox.';
    return null;
  }
  // fetch() network failures: "Failed to fetch", "NetworkError when…",
  // "Load failed" (Safari).
  if (
    error instanceof TypeError &&
    /fetch|network|load failed/iu.test(error.message)
  )
    return 'Can’t reach Beacon. Check your internet connection and try again.';
  return null;
}

/**
 * The one way screens turn a caught error into words.
 * - API failures already carry friendly text (see api.ts).
 * - Browser errors are translated.
 * - Errors Beacon's own code throws are written for people and pass
 *   through.
 * - Anything else gets the screen's own `fallback`, which should say what
 *   didn't happen ("The camera couldn’t be renamed.").
 */
export function friendlyError(error: unknown, fallback: string): string {
  // Checked first: DOMException isn't an Error subclass everywhere.
  if (error instanceof DOMException)
    return browserErrorMessage(error) ?? fallback;
  if (error instanceof Error) {
    if (error.name === 'ApiError') return error.message || fallback;
    const browser = browserErrorMessage(error);
    if (browser) return browser;
    if (error instanceof DOMException) return fallback;
    return error.message && !/^[a-z]/u.test(error.message)
      ? error.message
      : fallback;
  }
  return fallback;
}
