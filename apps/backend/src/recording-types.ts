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
