export type RecordingStatus =
  | 'requested'
  | 'recording'
  | 'uploading'
  | 'available'
  | 'failed'
  | 'deleting'
  | 'deleted';

export interface RecordingRecord {
  id: string;
  cameraId: string;
  cameraName: string;
  deviceName: string;
  createdByUserId: string;
  status: RecordingStatus;
  durationMs: number | null;
  byteSize: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Null for a manually started recording; set when motion (or another
   * detection) triggered it automatically. */
  triggerMotionEventId: string | null;
  /** Sub-second-precision `created_at` for keyset pagination cursors --
   * `created_at` alone can collide for recordings requested in the same
   * millisecond, so cursors also key on `id`. See recording-history.ts. */
  cursorTimestamp: string;
  /** Whether a thumbnail has finished uploading -- never assume one exists
   * just because the clip is available. See ADR 0078. */
  hasThumbnail: boolean;
}

export interface RecordingThumbnailUploadClaim {
  byteSize: number;
  mimeType: 'image/jpeg' | 'image/webp';
  recordingId: string;
  userId: string;
}

/** Same fields as RecordingPlaybackClaim, for the thumbnail's own
 * independent encryption envelope (see ADR 0078). Kept as a separate type
 * rather than reusing RecordingPlaybackClaim so a thumbnail claim can never
 * be passed where a clip claim is expected, or vice versa. */
export interface RecordingThumbnailPlaybackClaim {
  providerFileId: string;
  byteSize: number;
  checksumSha256: string;
  mimeType: 'image/jpeg' | 'image/webp';
  encryptionIv: Buffer;
  encryptionDataKeyCiphertext: Buffer;
  encryptionDataKeyIv: Buffer;
  userId: string;
}

export interface RecordingUploadClaim {
  byteSize: number;
  mimeType: 'video/mp4' | 'video/webm';
  recordingId: string;
  userId: string;
}

export interface RecordingDeletionClaim {
  providerFileId: string;
  recordingId: string;
  userId: string;
}

export interface RecordingPlaybackClaim {
  providerFileId: string;
  byteSize: number;
  checksumSha256: string;
  mimeType: 'video/mp4' | 'video/webm';
  encryptionIv: Buffer;
  encryptionDataKeyCiphertext: Buffer;
  encryptionDataKeyIv: Buffer;
  userId: string;
}

/** The owner-facing view of a recording's share link -- never the raw
 * token, which is only ever returned once, at creation. */
export interface RecordingShareLinkStatus {
  id: string;
  expiresAt: Date;
}

/** Resolved from a share token by an unauthenticated request. Combines the
 * link's own validity (expiry/revocation, checked by the caller) with the
 * same playback fields RecordingPlaybackClaim needs, so a share-token
 * playback request is a single query rather than two round trips that
 * could disagree with each other. */
export interface RecordingShareLinkPlaybackClaim extends RecordingPlaybackClaim {
  shareLinkId: string;
  recordingId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}
