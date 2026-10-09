# Oracle capacity — October 9, 2026

Read-only inspection over the existing private SSH route found:

| Resource              | Before                                | After inspection                     |
| --------------------- | ------------------------------------- | ------------------------------------ |
| Architecture          | ARM64                                 | unchanged                            |
| CPUs exposed to Linux | 2                                     | unchanged                            |
| RAM                   | approximately 12 GB (11 GiB reported) | unchanged                            |
| Boot disk             | 60 GiB                                | unchanged                            |
| Root filesystem       | 58 GiB; 46 GiB used; 12 GiB available | 22 GiB used; 36 GiB available        |
| Swap                  | none                                  | unchanged                            |
| Load average          | 0.17 / 0.11 / 0.08                    | sampled, not a sustained measurement |

Approximately 1.7 GiB RAM was used, with 9 GiB available. Container memory samples
were approximately backend 64 MiB, PostgreSQL 51 MiB, Coturn 163 MiB, web/Caddy
15 MiB. PostgreSQL was healthy; public HTTPS `/health` and database-backed
`/ready` returned success. Docker build cache occupied 37.39 GB, with 33.96 GB
reported reclaimable. A bounded cleanup of build cache older than seven days,
with an 8 GB retention target, reclaimed 26.46 GB (Docker's decimal units).
The root filesystem fell from 80% to 38% used. No persistent volumes or rollback
images were removed. Database-backed readiness remained successful afterward;
no additional storage allocation is currently justified.

Current [official Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
lists 1,500 A1 OCPU-hours and 9,000 GB-hours monthly, equivalent to **2 OCPUs and
12 GB**, plus **200 GB combined boot/block storage in the home region** and five
volume backups. Older cached pages listing 4 OCPUs/24 GB must not guide resizing.

After the owner signed in, read-only OCI console inspection confirmed the tenancy
is a **Free Tier account**, Ashburn is its **home region**, and the running
`beacon-staging-1` instance uses **VM.Standard.A1.Flex, 2 OCPUs, 12 GB RAM**.
The tenancy's Compute limits for AD-1 explicitly show `standard-a1-core-count`
**2** and `standard-a1-memory-count` **12**. The instance-list banner still quotes
the historical 4/24 allowance; the actual limit table and current official
documentation agree on 2/12. No larger shape is justified or attempted.

The Block Volume regional limits for the root tenancy show
`total-free-storage-gb-regional`: **200 GB limit, 60 GB usage, 140 GB available**.
Both backup-count limits show **5 limit, 0 usage, 5 available**. These values are
from the console's completed usage table, not an inference from the Linux disk.
The storage quota is shared across boot/block volumes; it is not additional
filesystem capacity until provisioned. Existing free space is sufficient, so
no volume, backup, compute change, account upgrade, or billable resource was made.

The monitoring timer is running. Backup timers are not enabled; the prior handoff
records an empty backup repository. A retained recovery point and current restore
verification are required before a disruptive infrastructure change. No reboot
or filesystem expansion was performed. Running Coturn alone does not prove a
real allocation or an end-to-end camera relay stream.

An authenticated Coturn `turnutils_uclient -y` client-to-client smoke attempt from
both the VM and the Windows Docker client reached the server but failed at
channel binding with `403 (Forbidden IP)`. The same-server relay test therefore
did not establish packet delivery. The existing `no-loopback-peers` control was
not relaxed to force it through. Validate actual two-device WebRTC relay behavior
before claiming TURN readiness for Beacon Remote; this check does not establish
whether a normal camera session succeeds or fails.
