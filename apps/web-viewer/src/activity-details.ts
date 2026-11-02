import { rejectionReasonLabel } from './access-history';

interface ActivityDetails {
  facts: { label: string; value: string }[];
  explanation?: string;
}

const recordingFailures = new Map([
  ['capture_failed', 'The camera could not capture the clip.'],
  ['encryption_failed', 'The clip could not be encrypted.'],
  ['upload_failed', 'The clip could not be uploaded.'],
  ['completion_failed', 'The uploaded clip could not be finalized.'],
  ['abandoned', 'The recording was stopped before it finished.'],
]);

/** Only interpret fields defined by the event's contract. Never render arbitrary
 * audit metadata, raw provider errors, tokens or share URLs as detail text. */
export function activityDetails(
  eventType: string,
  metadata: Record<string, string>,
): ActivityDetails {
  switch (eventType) {
    case 'recording_requested':
      return {
        facts: [{ label: 'Recorded outcome', value: 'Recording requested' }],
        explanation:
          'A recording was requested at this time. This does not confirm that the clip finished or is still available.',
      };
    case 'recording_available':
      return {
        facts: [{ label: 'Recorded outcome', value: 'Clip became available' }],
        explanation:
          'The clip became available at this time. It may have been deleted or expired since then.',
      };
    case 'recording_failed':
      return {
        facts: [
          { label: 'Recorded outcome', value: 'Recording failed' },
          {
            label: 'Reason',
            value:
              recordingFailures.get(metadata.reason ?? '') ??
              'The recording could not be completed. No recognized reason was recorded.',
          },
        ],
      };
    case 'recording_deleted':
      return {
        facts: [{ label: 'Recorded outcome', value: 'Clip deleted' }],
        explanation:
          'This event records the deletion. It does not contain a playable copy of the clip.',
      };
    case 'recording_share_link_created': {
      const rawExpiry = metadata.expiresAt ?? '';
      const expiry =
        typeof rawExpiry === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(rawExpiry)
          ? new Date(rawExpiry)
          : null;
      return {
        facts: [
          { label: 'Recorded outcome', value: 'Share link created' },
          {
            label: 'Recorded link expiry',
            value:
              expiry &&
              Number.isFinite(expiry.getTime()) &&
              expiry.toISOString() ===
                (rawExpiry.includes('.')
                  ? rawExpiry
                  : rawExpiry.replace('Z', '.000Z'))
                ? expiry.toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : 'Not recorded',
          },
        ],
        explanation:
          'This is the expiry set when the link was created. The link may have expired or been revoked since then.',
      };
    }
    case 'recording_share_link_revoked':
      return {
        facts: [{ label: 'Recorded outcome', value: 'Share link revoked' }],
        explanation:
          'This share link was revoked. This event does not describe other links to the clip.',
      };
    case 'live_view_rejected':
      return {
        facts: [
          {
            label: 'Reason',
            value: rejectionReasonLabel(metadata.reason ?? null),
          },
        ],
      };
    default:
      return { facts: [] };
  }
}
