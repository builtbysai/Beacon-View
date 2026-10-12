import { OAuth2Client } from 'google-auth-library';

import type { AppConfig } from './config.js';
import {
  DriveReconnectRequiredError,
  GOOGLE_DRIVE_RECORDING_SCOPE,
  refreshDriveAccessToken,
} from './google-drive-client.js';
import type { MilestoneStore } from './store.js';

const DRIVE_RECONNECT_MESSAGE =
  'Google Drive disconnected, so Beacon can’t save or open recordings. Reconnect Google Drive to continue.';
const DRIVE_NOT_CONNECTED_MESSAGE = 'Connect Google Drive to save recordings.';

/** Recording storage is not connected at all (never, or disconnected). */
class DriveNotConnectedError extends Error {
  constructor() {
    super(DRIVE_NOT_CONNECTED_MESSAGE);
    this.name = 'DriveNotConnectedError';
  }
}

/** A connection is re-checked at most this often, so a dead token is
 * noticed before the owner tries to record (ADR 0086). */
export const DRIVE_HEALTH_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

/** Which connection a caller needs: any (app data) or recordings. */
type DriveNeed = 'any' | 'recordings';

function satisfies(scopes: string, need: DriveNeed): boolean {
  return (
    need === 'any' ||
    scopes.split(/\s+/u).includes(GOOGLE_DRIVE_RECORDING_SCOPE)
  );
}

type DriveProblemCode = 'drive_not_connected' | 'drive_reconnect_required';

function driveProblemBody(code: DriveProblemCode): {
  code: DriveProblemCode;
  error: string;
} {
  return {
    code,
    error:
      code === 'drive_reconnect_required'
        ? DRIVE_RECONNECT_MESSAGE
        : DRIVE_NOT_CONNECTED_MESSAGE,
  };
}

/** The response body for a Drive failure the owner can fix, or null for any
 * other error (which callers report as temporarily unavailable). */
export function driveProblem(
  error: unknown,
): { code: DriveProblemCode; error: string } | null {
  if (error instanceof DriveReconnectRequiredError)
    return driveProblemBody('drive_reconnect_required');
  if (error instanceof DriveNotConnectedError)
    return driveProblemBody('drive_not_connected');
  return null;
}

/**
 * Owns Drive token refreshes (ADR 0086). Google rejecting a refresh token
 * (`invalid_grant`) is permanent, so the connection is marked expired at
 * once: every later request reads it as absent, and the app asks the owner
 * to reconnect instead of failing a recording at upload time. Transient
 * failures (network, Google 5xx) never expire a connection.
 */
export class DriveHealth {
  // When each user's token was last confirmed live. In memory: a restart
  // only costs one extra refresh.
  readonly #confirmedAt = new Map<string, number>();

  constructor(
    private readonly store: MilestoneStore,
    private readonly config: Pick<
      AppConfig,
      | 'GOOGLE_OAUTH_CLIENT_ID'
      | 'GOOGLE_OAUTH_CLIENT_SECRET'
      | 'GOOGLE_OAUTH_REDIRECT_URI'
    >,
    private readonly now: () => number = Date.now,
  ) {}

  /** A fresh access token for recording storage. Throws
   * DriveNotConnectedError, DriveReconnectRequiredError (after marking the
   * connection expired), or a transient error. */
  recordingAccessToken(userId: string, householdId?: string): Promise<string> {
    return this.accessToken(userId, householdId, 'recordings');
  }

  async accessToken(
    userId: string,
    householdId: string | undefined,
    need: DriveNeed,
  ): Promise<string> {
    if (!this.config.GOOGLE_OAUTH_CLIENT_ID)
      throw new Error('Google Drive is unavailable');
    const [refreshToken, drive] = await Promise.all([
      this.store.getGoogleDriveRefreshToken(userId),
      this.store.getGoogleDriveConnection(userId),
    ]);
    if (!refreshToken || !drive || !satisfies(drive.scopes, need))
      throw new DriveNotConnectedError();
    try {
      const token = await refreshDriveAccessToken(
        new OAuth2Client(
          this.config.GOOGLE_OAUTH_CLIENT_ID,
          this.config.GOOGLE_OAUTH_CLIENT_SECRET,
          this.config.GOOGLE_OAUTH_REDIRECT_URI,
        ),
        refreshToken,
      );
      this.#confirmedAt.set(userId, this.now());
      return token;
    } catch (error) {
      if (error instanceof DriveReconnectRequiredError)
        await this.expire(userId, householdId).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Confirms the connection still works, refreshing the token at most
   * hourly. Resolves to the problem the owner must fix, or null when Drive
   * is ready -- or only transiently unreachable, since a blip never blocks.
   */
  async problem(
    userId: string,
    householdId: string | undefined,
    need: DriveNeed,
  ): Promise<DriveProblemCode | null> {
    const checkedAt = this.#confirmedAt.get(userId);
    if (
      checkedAt !== undefined &&
      this.now() - checkedAt < DRIVE_HEALTH_CHECK_INTERVAL_MS
    ) {
      // Confirmed recently, unless it was disconnected meanwhile.
      const drive = await this.store.getGoogleDriveConnection(userId);
      if (drive && satisfies(drive.scopes, need)) return null;
      return this.absentProblem(userId);
    }
    try {
      await this.accessToken(userId, householdId, need);
      return null;
    } catch (error) {
      const problem = driveProblem(error);
      if (!problem) return null;
      return problem.code === 'drive_not_connected'
        ? this.absentProblem(userId)
        : problem.code;
    }
  }

  async expire(userId: string, householdId?: string): Promise<void> {
    this.#confirmedAt.delete(userId);
    if (await this.store.markGoogleDriveConnectionExpired(userId))
      await this.store.audit({
        eventType: 'google_drive_connection_expired',
        success: true,
        userId,
        ...(householdId ? { householdId } : {}),
      });
  }

  /** Forgets a confirmation, e.g. after the owner disconnects Drive. */
  forget(userId: string): void {
    this.#confirmedAt.delete(userId);
  }

  private async absentProblem(userId: string): Promise<DriveProblemCode> {
    return (await this.store.googleDriveConnectionExpired(userId))
      ? 'drive_reconnect_required'
      : 'drive_not_connected';
  }
}
