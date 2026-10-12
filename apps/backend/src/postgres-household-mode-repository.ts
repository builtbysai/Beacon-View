import type { Pool, PoolClient } from 'pg';

import {
  DEFAULT_MODE_SETTINGS,
  type HouseholdMode,
  type ModeSettings,
  modeFromSchedule,
  modeSettingsSchema,
} from './home-away.js';

export interface HouseholdModeRecord {
  mode: HouseholdMode;
  /** Who last changed it: a person, or the schedule. */
  source: 'manual' | 'schedule';
  changedAt: Date;
  settings: ModeSettings;
}

/** Cameras whose privacy mode a mode change flipped, by public camera ID. */
interface ModeCameraChanges {
  paused: string[];
  resumed: string[];
}

export interface HouseholdModeChange extends ModeCameraChanges {
  householdId: string;
  record: HouseholdModeRecord;
}

interface ModeRow {
  mode: HouseholdMode;
  source: 'manual' | 'schedule';
  scheduleMode: HouseholdMode | null;
  settings: unknown;
  changedAt: Date;
}

function readSettings(value: unknown): ModeSettings {
  const parsed = modeSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_MODE_SETTINGS;
}

function toRecord(row: ModeRow): HouseholdModeRecord {
  return {
    mode: row.mode,
    source: row.source,
    changedAt: row.changedAt,
    settings: readSettings(row.settings),
  };
}

/**
 * Home and Away (ADR 0094). A household has at most one row; none means it is
 * Away with the default settings. Changing mode, saving settings and the
 * schedule scan all run in one transaction on that row, so a manual change
 * and a scheduled one cannot interleave.
 */
export class PostgresHouseholdModeRepository {
  constructor(private readonly pool: Pool) {}

  async get(householdId: string): Promise<HouseholdModeRecord> {
    const result = await this.pool.query<ModeRow>(
      `SELECT mode, source, schedule_mode AS "scheduleMode", settings, changed_at AS "changedAt"
       FROM household_modes WHERE household_id = $1`,
      [householdId],
    );
    const row = result.rows[0];
    return row
      ? toRecord(row)
      : {
          mode: 'away',
          source: 'manual',
          changedAt: new Date(0),
          settings: DEFAULT_MODE_SETTINGS,
        };
  }

  async setMode(
    householdId: string,
    mode: HouseholdMode,
    userId: string | null,
    source: 'manual' | 'schedule',
    now: Date,
  ): Promise<HouseholdModeChange> {
    return this.#transaction(async (client) => {
      const row = await this.#lock(client, householdId);
      const settings = readSettings(row.settings);
      const changes = await this.#applyCameras(
        client,
        householdId,
        mode,
        settings,
      );
      const scheduleMode = settings.schedule
        ? modeFromSchedule(settings.schedule, now)
        : null;
      const updated = await client.query<ModeRow>(
        `UPDATE household_modes
         SET mode = $2, source = $3, changed_at = $4, changed_by = $5,
             schedule_mode = $6
         WHERE household_id = $1
         RETURNING mode, source, schedule_mode AS "scheduleMode", settings, changed_at AS "changedAt"`,
        [householdId, mode, source, now, userId, scheduleMode],
      );
      return {
        householdId,
        record: toRecord(updated.rows[0]!),
        ...changes,
      };
    });
  }

  /**
   * Saves the settings. A schedule applies at once: the household takes the
   * mode the schedule asks for now, so saving "home from 18:00" at 19:00 is
   * Home straight away. Without a schedule the current mode stays, and its
   * camera effects are re-applied in case the pause options changed.
   */
  async saveSettings(
    householdId: string,
    settings: ModeSettings,
    now: Date,
  ): Promise<HouseholdModeChange> {
    return this.#transaction(async (client) => {
      const row = await this.#lock(client, householdId);
      const scheduled = settings.schedule
        ? modeFromSchedule(settings.schedule, now)
        : null;
      const mode = scheduled ?? row.mode;
      const changed = mode !== row.mode;
      const changes = await this.#applyCameras(
        client,
        householdId,
        mode,
        settings,
      );
      const updated = await client.query<ModeRow>(
        `UPDATE household_modes
         SET settings = $2::jsonb, schedule_mode = $3, mode = $4,
             source = CASE WHEN $5 THEN 'schedule' ELSE source END,
             changed_at = CASE WHEN $5 THEN $6 ELSE changed_at END,
             changed_by = CASE WHEN $5 THEN NULL ELSE changed_by END
         WHERE household_id = $1
         RETURNING mode, source, schedule_mode AS "scheduleMode", settings, changed_at AS "changedAt"`,
        [householdId, JSON.stringify(settings), scheduled, mode, changed, now],
      );
      return {
        householdId,
        record: toRecord(updated.rows[0]!),
        ...changes,
      };
    });
  }

  /**
   * Moves every household whose schedule has changed its mind since the last
   * scan. A manual change therefore stands until the schedule next flips.
   */
  async scanSchedules(now: Date): Promise<HouseholdModeChange[]> {
    const candidates = await this.pool.query<{ householdId: string }>(
      `SELECT household_id AS "householdId" FROM household_modes
       WHERE settings -> 'schedule' IS NOT NULL
         AND settings -> 'schedule' <> 'null'::jsonb`,
    );
    const changes: HouseholdModeChange[] = [];
    for (const { householdId } of candidates.rows) {
      const change = await this.#transaction(async (client) => {
        const locked = await client.query<ModeRow>(
          `SELECT mode, source, schedule_mode AS "scheduleMode", settings, changed_at AS "changedAt"
           FROM household_modes WHERE household_id = $1 FOR UPDATE SKIP LOCKED`,
          [householdId],
        );
        const row = locked.rows[0];
        if (!row) return null;
        const settings = readSettings(row.settings);
        if (!settings.schedule) return null;
        const wanted = modeFromSchedule(settings.schedule, now);
        if (wanted === row.scheduleMode) return null;
        if (wanted === row.mode) {
          await client.query(
            `UPDATE household_modes SET schedule_mode = $2 WHERE household_id = $1`,
            [householdId, wanted],
          );
          return null;
        }
        const cameras = await this.#applyCameras(
          client,
          householdId,
          wanted,
          settings,
        );
        const updated = await client.query<ModeRow>(
          `UPDATE household_modes
           SET mode = $2, source = 'schedule', schedule_mode = $2, changed_at = $3,
               changed_by = NULL
           WHERE household_id = $1
           RETURNING mode, source, schedule_mode AS "scheduleMode", settings, changed_at AS "changedAt"`,
          [householdId, wanted, now],
        );
        return {
          householdId,
          record: toRecord(updated.rows[0]!),
          ...cameras,
        };
      });
      if (change) changes.push(change);
    }
    return changes;
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** The household's row, created with defaults on first use, and locked. */
  async #lock(client: PoolClient, householdId: string): Promise<ModeRow> {
    await client.query(
      `INSERT INTO household_modes (household_id, settings)
       VALUES ($1, $2::jsonb) ON CONFLICT (household_id) DO NOTHING`,
      [householdId, JSON.stringify(DEFAULT_MODE_SETTINGS)],
    );
    const locked = await client.query<ModeRow>(
      `SELECT mode, source, schedule_mode AS "scheduleMode", settings, changed_at AS "changedAt"
       FROM household_modes WHERE household_id = $1 FOR UPDATE`,
      [householdId],
    );
    return locked.rows[0]!;
  }

  /**
   * Home pauses the household's Android cameras when asked to; Away resumes
   * only those Home paused, and only when the owner opted in. Otherwise Away
   * just forgets which cameras Home paused, so a pause never turns into an
   * automatic resume later.
   */
  async #applyCameras(
    client: PoolClient,
    householdId: string,
    mode: HouseholdMode,
    settings: ModeSettings,
  ): Promise<ModeCameraChanges> {
    if (mode === 'home') {
      if (!settings.pauseCamerasWhenHome) return { paused: [], resumed: [] };
      const changed = await client.query<{ id: string }>(
        `UPDATE cameras SET privacy_mode = true, paused_by_mode = true, updated_at = now()
         WHERE household_id = $1 AND platform = 'android' AND revoked_at IS NULL
           AND privacy_mode = false
         RETURNING id`,
        [householdId],
      );
      return {
        paused: await this.#publicCameraIds(
          client,
          changed.rows.map((row) => row.id),
        ),
        resumed: [],
      };
    }
    if (!settings.resumeCamerasWhenAway) {
      await client.query(
        `UPDATE cameras SET paused_by_mode = false
         WHERE household_id = $1 AND paused_by_mode`,
        [householdId],
      );
      return { paused: [], resumed: [] };
    }
    const changed = await client.query<{ id: string }>(
      `UPDATE cameras SET privacy_mode = false, paused_by_mode = false, updated_at = now()
       WHERE household_id = $1 AND paused_by_mode AND revoked_at IS NULL
       RETURNING id`,
      [householdId],
    );
    return {
      paused: [],
      resumed: await this.#publicCameraIds(
        client,
        changed.rows.map((row) => row.id),
      ),
    };
  }

  async #publicCameraIds(
    client: PoolClient,
    deviceIds: string[],
  ): Promise<string[]> {
    if (deviceIds.length === 0) return [];
    const result = await client.query<{ id: string }>(
      `SELECT public_camera_id AS id FROM camera_sources WHERE device_id = ANY($1::uuid[])`,
      [deviceIds],
    );
    return result.rows.map((row) => row.id);
  }
}
