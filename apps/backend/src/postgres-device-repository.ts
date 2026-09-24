import type { Pool } from 'pg';
import type {
  AccessibleCameraRecord,
  CameraIdentity,
  CameraAccess,
  CameraRecord,
  CameraSourceInput,
  DeviceRecord,
  DeviceHeartbeatIdentity,
} from './store-contract.js';

export class PostgresDeviceRepository {
  constructor(private readonly pool: Pool) {}

  async listCameras(householdId: string): Promise<CameraRecord[]> {
    const result = await this.pool.query<CameraRecord>(
      `SELECT cs.id, cs.device_id AS "deviceId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId",
              d.name AS "deviceName", d.platform,
              cs.display_name AS name, cs.source_key AS "sourceKey",
              cs.facing, cs.enabled, d.privacy_mode AS "privacyMode",
              cs.capabilities,
              COALESCE(cs.last_seen_at, d.last_seen_at) AS "lastSeenAt",
              COALESCE(dc.revoked_at, d.revoked_at) AS "credentialRevokedAt",
              d.paired_by_user_id AS "pairedByUserId"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1 AND cs.removed_at IS NULL
       ORDER BY d.created_at, cs.created_at`,
      [householdId],
    );
    return result.rows;
  }

  async listDevices(householdId: string): Promise<DeviceRecord[]> {
    const result = await this.pool.query<DeviceRecord>(
      `SELECT d.id, d.public_device_id AS "publicDeviceId", d.name,
              d.platform, d.device_type AS "deviceType",
              d.last_seen_at AS "lastSeenAt",
              COALESCE(dc.revoked_at, d.revoked_at) AS "revokedAt",
              d.software_version AS "softwareVersion", d.enabled,
              d.privacy_mode AS "privacyMode", d.battery_percent AS "batteryPercent",
              d.battery_charging AS "batteryCharging", d.health_reported_at AS "healthReportedAt",
              d.capabilities, d.paired_by_user_id AS "pairedByUserId"
       FROM cameras d
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1
       ORDER BY d.created_at`,
      [householdId],
    );
    return result.rows;
  }

  async listAccessibleCameras(
    householdId: string,
    userId: string,
    role: 'owner' | 'admin' | 'viewer' | 'guest',
  ): Promise<AccessibleCameraRecord[]> {
    const cameras = await this.listCameras(householdId);
    if (role === 'owner' || role === 'admin')
      return cameras.map((camera) => ({
        ...camera,
        canFlip: true,
        canListen: true,
        canPause: true,
        canTalk: true,
      }));
    const grants = await this.pool.query<{
      publicCameraId: string;
      canListen: boolean;
      canTalk: boolean;
      canFlip: boolean;
      canPause: boolean;
    }>(
      `SELECT cs.public_camera_id AS "publicCameraId", cg.can_listen AS "canListen",
              cg.can_talk AS "canTalk", cg.can_flip AS "canFlip", cg.can_pause AS "canPause"
       FROM household_members m
       JOIN camera_grants cg ON cg.member_id = m.id
                            AND cg.household_id = m.household_id
       JOIN camera_sources cs ON cs.id = cg.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       WHERE m.household_id = $1 AND m.user_id = $2
         AND m.status = 'active'
         AND (m.expires_at IS NULL OR m.expires_at > now())
         AND d.household_id = $1 AND cs.removed_at IS NULL`,
      [householdId, userId],
    );
    const allowed = new Map(
      grants.rows.map((grant) => [grant.publicCameraId, grant]),
    );
    return cameras.flatMap((camera) => {
      const grant = allowed.get(camera.publicCameraId);
      if (!grant) return [];
      return [
        {
          ...camera,
          canFlip: grant.canFlip,
          canListen: grant.canListen,
          canPause: grant.canPause,
          canTalk: grant.canTalk,
        },
      ];
    });
  }

  async listAccessibleDevices(
    householdId: string,
    userId: string,
    role: 'owner' | 'admin' | 'viewer' | 'guest',
  ): Promise<DeviceRecord[]> {
    const [devices, cameras] = await Promise.all([
      this.listDevices(householdId),
      this.listAccessibleCameras(householdId, userId, role),
    ]);
    if (role === 'owner' || role === 'admin') return devices;
    const allowed = new Set(cameras.map((camera) => camera.publicDeviceId));
    return devices.filter((device) => allowed.has(device.publicDeviceId));
  }

  async syncCameras(
    credentialHash: string,
    sources: CameraSourceInput[],
    now: Date,
  ): Promise<CameraRecord[] | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query<{ deviceId: string }>(
        `SELECT d.id AS "deviceId"
         FROM cameras d
         JOIN device_credentials dc ON dc.camera_id = d.id
         WHERE dc.credential_hash = $1 AND dc.revoked_at IS NULL
           AND d.revoked_at IS NULL
         FOR UPDATE`,
        [credentialHash],
      );
      const deviceId = identity.rows[0]?.deviceId;
      if (!deviceId) {
        await client.query('ROLLBACK');
        return null;
      }
      const rearSource = sources.find((source) => source.facing === 'rear');
      if (rearSource) {
        await client.query(
          `UPDATE camera_sources SET source_key = $2, updated_at = $3
           WHERE device_id = $1 AND source_key = 'legacy-default'
             AND NOT EXISTS (
               SELECT 1 FROM camera_sources
               WHERE device_id = $1 AND source_key = $2
             )`,
          [deviceId, rearSource.sourceKey, now],
        );
      }
      for (const source of sources) {
        const inserted = await client.query<{ publicCameraId: string }>(
          `INSERT INTO camera_sources
             (device_id, display_name, source_key, facing, capabilities,
              last_seen_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (device_id, source_key) DO NOTHING
           RETURNING public_camera_id AS "publicCameraId"`,
          [
            deviceId,
            source.name,
            source.sourceKey,
            source.facing,
            JSON.stringify(source.capabilities ?? {}),
            now,
          ],
        );
        if (inserted.rows[0]) {
          await client.query(
            `INSERT INTO audit_events (household_id, camera_id, event_type, success, metadata)
             SELECT d.household_id, d.id, 'camera_source_added', true,
                    jsonb_build_object('deviceId', d.public_device_id::text,
                                       'deviceName', d.name,
                                       'cameraId', $2::text, 'cameraName', $3::text)
             FROM cameras d WHERE d.id = $1`,
            [deviceId, inserted.rows[0].publicCameraId, source.name],
          );
        } else {
          await client.query(
            `UPDATE camera_sources SET facing = $3, capabilities = $4,
                    last_seen_at = $5, updated_at = $5
             WHERE device_id = $1 AND source_key = $2 AND removed_at IS NULL`,
            [
              deviceId,
              source.sourceKey,
              source.facing,
              JSON.stringify(source.capabilities ?? {}),
              now,
            ],
          );
        }
      }
      await client.query(
        `UPDATE cameras SET last_seen_at = $2, updated_at = $2 WHERE id = $1`,
        [deviceId, now],
      );
      await client.query('COMMIT');
      const household = await this.pool.query<{ householdId: string }>(
        `SELECT household_id AS "householdId" FROM cameras WHERE id = $1`,
        [deviceId],
      );
      return (await this.listCameras(household.rows[0]!.householdId)).filter(
        (camera) => camera.deviceId === deviceId,
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async registerBrowser(input: {
    householdId: string;
    installationId: string;
    name: string;
    sources: CameraSourceInput[];
    now: Date;
    createdByUserId?: string;
  }): Promise<{ device: DeviceRecord; cameras: CameraRecord[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const device = await client.query<DeviceRecord>(
        `INSERT INTO cameras
           (household_id, installation_id, name, platform, device_type,
            last_seen_at, updated_at, paired_by_user_id)
         VALUES ($1, $2, $3, 'browser', 'browser', $4, $4, $5)
         ON CONFLICT (installation_id) DO UPDATE SET
           last_seen_at = EXCLUDED.last_seen_at,
           updated_at = EXCLUDED.updated_at
         WHERE cameras.household_id = EXCLUDED.household_id
           AND cameras.platform = 'browser'
         RETURNING id, public_device_id AS "publicDeviceId", name, platform,
                   device_type AS "deviceType", last_seen_at AS "lastSeenAt",
                   revoked_at AS "revokedAt",
                   software_version AS "softwareVersion", enabled,
                   capabilities, paired_by_user_id AS "pairedByUserId"`,
        [
          input.householdId,
          input.installationId,
          input.name,
          input.now,
          input.createdByUserId ?? null,
        ],
      );
      const created = device.rows[0];
      if (!created) throw new Error('Browser device ownership conflict');
      // Same default-on notification opt-in as native pairing (see
      // PostgresPairingRepository.redeem); ON CONFLICT DO NOTHING makes this
      // safe to run on every upsert, not only a device's first registration.
      await client.query(
        `INSERT INTO notification_preferences
           (user_id, device_id, motion_enabled, offline_enabled)
         SELECT h.owner_id, $1, true, true
         FROM households h WHERE h.id = $2
         ON CONFLICT (user_id, device_id) DO NOTHING`,
        [created.id, input.householdId],
      );
      for (const source of input.sources) {
        const inserted = await client.query<{ publicCameraId: string }>(
          `INSERT INTO camera_sources
             (device_id, display_name, source_key, facing, capabilities,
              last_seen_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (device_id, source_key) DO NOTHING
           RETURNING public_camera_id AS "publicCameraId"`,
          [
            created.id,
            source.name,
            source.sourceKey,
            source.facing,
            JSON.stringify(source.capabilities ?? {}),
            input.now,
          ],
        );
        if (inserted.rows[0]) {
          await client.query(
            `INSERT INTO audit_events
               (user_id, household_id, camera_id, event_type, success, metadata)
             VALUES ($1, $2, $3, 'camera_source_added', true,
                     jsonb_build_object('deviceId', $4::text, 'deviceName', $5::text,
                                        'cameraId', $6::text, 'cameraName', $7::text))`,
            [
              input.createdByUserId ?? null,
              input.householdId,
              created.id,
              created.publicDeviceId,
              created.name,
              inserted.rows[0].publicCameraId,
              source.name,
            ],
          );
        } else {
          await client.query(
            `UPDATE camera_sources SET facing = $3, capabilities = $4,
                    last_seen_at = $5, updated_at = $5
             WHERE device_id = $1 AND source_key = $2 AND removed_at IS NULL`,
            [
              created.id,
              source.sourceKey,
              source.facing,
              JSON.stringify(source.capabilities ?? {}),
              input.now,
            ],
          );
        }
        // Mirrors PostgresPairingRepository.redeem: a viewer who registers
        // their own browser camera gets full access to it immediately, not
        // just after an admin visits Members and grants it back to them.
        if (input.createdByUserId) {
          await client.query(
            `INSERT INTO camera_grants
               (household_id, member_id, camera_source_id, can_listen, can_talk, can_flip, can_pause)
             SELECT $1, m.id, cs.id, true, true, true, true
             FROM household_members m
             JOIN camera_sources cs ON cs.device_id = $2 AND cs.source_key = $4
             WHERE m.household_id = $1 AND m.user_id = $3
               AND m.status = 'active' AND m.role = 'viewer'
               AND cs.removed_at IS NULL
             ON CONFLICT (member_id, camera_source_id) DO NOTHING`,
            [
              input.householdId,
              created.id,
              input.createdByUserId,
              source.sourceKey,
            ],
          );
        }
      }
      await client.query('COMMIT');
      return {
        device: created,
        cameras: (await this.listCameras(input.householdId)).filter(
          (camera) => camera.deviceId === created.id,
        ),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(
    credentialHash: string,
    now: Date,
    health?: { batteryPercent: number; batteryCharging: boolean },
  ): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE cameras c SET last_seen_at = $2, updated_at = $2,
         battery_percent = COALESCE($3::int, battery_percent), battery_charging = COALESCE($4::boolean, battery_charging),
         health_reported_at = CASE WHEN $3::int IS NULL THEN health_reported_at ELSE $2 END
       FROM device_credentials dc
       WHERE dc.camera_id = c.id AND dc.credential_hash = $1
         AND dc.revoked_at IS NULL AND c.revoked_at IS NULL
       RETURNING c.id`,
      [
        credentialHash,
        now,
        health?.batteryPercent ?? null,
        health?.batteryCharging ?? null,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  async updateDevice(
    householdId: string,
    publicDeviceId: string,
    changes: { enabled?: boolean | undefined; name?: string | undefined },
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE cameras SET name = COALESCE($3, name),
         enabled = COALESCE($4, enabled), updated_at = now()
       WHERE household_id = $1 AND public_device_id = $2
         AND revoked_at IS NULL`,
      [
        householdId,
        publicDeviceId,
        changes.name ?? null,
        changes.enabled ?? null,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async updateCamera(
    householdId: string,
    publicCameraId: string,
    changes: { enabled?: boolean | undefined; name?: string | undefined },
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE camera_sources cs SET
         display_name = COALESCE($3, cs.display_name),
         enabled = COALESCE($4, cs.enabled),
         updated_at = now()
       FROM cameras d
       WHERE cs.device_id = d.id AND d.household_id = $1
         AND cs.public_camera_id = $2 AND d.revoked_at IS NULL
         AND cs.removed_at IS NULL`,
      [
        householdId,
        publicCameraId,
        changes.name ?? null,
        changes.enabled ?? null,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setPrivacyMode(
    householdId: string,
    publicDeviceId: string,
    enabled: boolean,
  ): Promise<string | null> {
    const result = await this.pool.query<{ deviceId: string }>(
      `UPDATE cameras SET privacy_mode = $3, updated_at = now()
       WHERE household_id = $1 AND public_device_id = $2
         AND platform = 'android' AND revoked_at IS NULL
       RETURNING id AS "deviceId"`,
      [householdId, publicDeviceId, enabled],
    );
    return result.rows[0]?.deviceId ?? null;
  }

  async revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ cameraId: string }>(
      `WITH revoked_device AS (
         UPDATE cameras SET revoked_at = now(), updated_at = now()
         WHERE public_device_id = $1 AND household_id = $2
           AND revoked_at IS NULL
         RETURNING id
       ), revoked_credential AS (
         UPDATE device_credentials SET revoked_at = now()
         WHERE camera_id IN (SELECT id FROM revoked_device)
           AND revoked_at IS NULL
       )
       SELECT id AS "cameraId" FROM revoked_device`,
      [publicDeviceId, householdId],
    );
    return result.rows[0]?.cameraId ?? null;
  }

  async deleteDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ cameraId: string }>(
      `DELETE FROM cameras
       WHERE household_id = $1 AND public_device_id = $2
       RETURNING id AS "cameraId"`,
      [householdId, publicDeviceId],
    );
    return result.rows[0]?.cameraId ?? null;
  }

  async deleteCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE camera_sources cs SET removed_at = now(), enabled = false,
         updated_at = now()
       FROM cameras d
       WHERE cs.device_id = d.id AND d.household_id = $1
         AND cs.public_camera_id = $2 AND cs.removed_at IS NULL`,
      [householdId, publicCameraId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findByCredential(
    credentialHash: string,
  ): Promise<DeviceHeartbeatIdentity | null> {
    const result = await this.pool.query<DeviceHeartbeatIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId",
              d.name, d.platform, d.installation_id AS "installationId",
              d.last_seen_at AS "lastSeenAt",
              d.battery_percent AS "batteryPercent",
              d.battery_charging AS "batteryCharging"
       FROM cameras d
       JOIN device_credentials dc ON dc.camera_id = d.id
       JOIN LATERAL (
         SELECT id, public_camera_id FROM camera_sources
         WHERE device_id = d.id
         ORDER BY created_at LIMIT 1
       ) cs ON true
       WHERE dc.credential_hash = $1 AND dc.revoked_at IS NULL
         AND d.revoked_at IS NULL`,
      [credentialHash],
    );
    return result.rows[0] ?? null;
  }

  async findCameraForCredential(
    credentialHash: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    const result = await this.pool.query<CameraIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE dc.credential_hash = $1 AND dc.revoked_at IS NULL
         AND d.revoked_at IS NULL AND cs.removed_at IS NULL
         AND cs.public_camera_id = $2`,
      [credentialHash, publicCameraId],
    );
    return result.rows[0] ?? null;
  }

  async findOwnedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    const result = await this.pool.query<CameraIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1 AND cs.public_camera_id = $2
         AND cs.enabled = true AND d.revoked_at IS NULL
         AND d.enabled = true AND d.privacy_mode = false
         AND cs.removed_at IS NULL
         AND (d.platform = 'browser' OR dc.revoked_at IS NULL)`,
      [householdId, publicCameraId],
    );
    return result.rows[0] ?? null;
  }

  async findAccessibleCamera(
    householdId: string,
    userId: string,
    role: 'owner' | 'admin' | 'viewer' | 'guest',
    publicCameraId: string,
  ): Promise<CameraAccess | null> {
    const result = await this.pool.query<CameraAccess>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId",
              CASE WHEN $3 IN ('owner', 'admin') THEN true
                   ELSE COALESCE(grant_access.can_listen, false) END AS "canListen",
              CASE WHEN $3 IN ('owner', 'admin') THEN true
                   ELSE COALESCE(grant_access.can_talk, false) END AS "canTalk",
              CASE WHEN $3 IN ('owner', 'admin') THEN true
                   ELSE COALESCE(grant_access.can_flip, false) END AS "canFlip",
              CASE WHEN $3 IN ('owner', 'admin') THEN true
                   ELSE COALESCE(grant_access.can_pause, false) END AS "canPause"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       LEFT JOIN LATERAL (
         SELECT cg.can_listen, cg.can_talk, cg.can_flip, cg.can_pause
         FROM household_members m
         JOIN camera_grants cg ON cg.member_id = m.id
                              AND cg.household_id = m.household_id
         WHERE m.household_id = $1 AND m.user_id = $2
           AND m.status = 'active'
           AND (m.expires_at IS NULL OR m.expires_at > now())
           AND cg.camera_source_id = cs.id
         LIMIT 1
       ) grant_access ON true
       WHERE d.household_id = $1 AND cs.public_camera_id = $4
         AND cs.enabled = true AND d.revoked_at IS NULL
         AND d.enabled = true AND d.privacy_mode = false
         AND cs.removed_at IS NULL
         AND (d.platform = 'browser' OR dc.revoked_at IS NULL)
         AND ($3 IN ('owner', 'admin') OR grant_access.can_talk IS NOT NULL)`,
      [householdId, userId, role, publicCameraId],
    );
    return result.rows[0] ?? null;
  }

  async findManagedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    const result = await this.pool.query<CameraIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1 AND cs.public_camera_id = $2
         AND d.revoked_at IS NULL AND cs.removed_at IS NULL
         AND (d.platform = 'browser' OR dc.revoked_at IS NULL)`,
      [householdId, publicCameraId],
    );
    return result.rows[0] ?? null;
  }
}
