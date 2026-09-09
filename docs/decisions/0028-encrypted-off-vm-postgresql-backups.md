# ADR 0028: Encrypted off-VM PostgreSQL backups

Status: Accepted for the Oracle Cloud private-alpha deployment.

## Decision

Create a daily PostgreSQL logical dump and send it to a private Oracle Object
Storage bucket using its S3-compatible endpoint. Restic encrypts and authenticates
the dump before upload using an independent repository password. Retain seven daily,
four weekly, and three monthly snapshots. A systemd timer performs the backup and a
separate weekly timer validates the repository metadata.

Restore verification always targets a separately created database. The supplied
restore helper refuses the live database and requires an explicit destructive-action
marker. This makes recovery testing routine without normalizing live-database
overwrites.

## Consequences

The Customer Secret Key belongs to a dedicated Oracle backup user whose IAM policy is
limited to listing the named bucket and managing objects in that named bucket. The
access key, secret key, and Restic repository password are stored only in the
owner-readable `/etc/beacon/backup.env`; neither belongs in application configuration,
Git, images, logs, or chat. The bucket must remain private, have a lifecycle policy
longer than the retained Restic history, and be in a different failure domain from the
VM. Backups contain account and device metadata but never media because Beacon does
not upload media.

This is a recoverable private-alpha design, not high availability or point-in-time
recovery. Repository checks do not prove an application restore; a separate restore
drill remains required after the first successful backup and at regular intervals.
