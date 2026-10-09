# Oracle capacity — October 9, 2026

Read-only inspection over the existing private SSH route found:

| Resource              | Before                                | After inspection                     |
| --------------------- | ------------------------------------- | ------------------------------------ |
| Architecture          | ARM64                                 | unchanged                            |
| CPUs exposed to Linux | 2                                     | unchanged                            |
| RAM                   | approximately 12 GB (11 GiB reported) | unchanged                            |
| Boot disk             | 60 GiB                                | unchanged                            |
| Root filesystem       | 58 GiB; 46 GiB used; 12 GiB available | unchanged                            |
| Swap                  | none                                  | unchanged                            |
| Load average          | 0.17 / 0.11 / 0.08                    | sampled, not a sustained measurement |

Approximately 1.7 GiB RAM was used, with 9 GiB available. Container memory samples
were approximately backend 64 MiB, PostgreSQL 51 MiB, Coturn 163 MiB, web/Caddy
15 MiB. PostgreSQL was healthy; public HTTPS `/health` and database-backed
`/ready` returned success. Docker build cache occupied 37.39 GB, with 33.96 GB
reported reclaimable. Prefer a bounded cache cleanup before adding storage; do
not remove persistent volumes or rollback release images.

Current [official Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
lists 1,500 A1 OCPU-hours and 9,000 GB-hours monthly, equivalent to **2 OCPUs and
12 GB**, plus **200 GB combined boot/block storage in the home region** and five
volume backups. Older cached pages listing 4 OCPUs/24 GB must not guide resizing.

The actual tenancy subscription, home region, shape, other allocated volumes,
remaining quota, and billing eligibility have **not** been verified: OCI console
requires sign-in, and no local OCI CLI configuration exists. No compute/storage
change, account upgrade, or billable resource was made. Do not claim remaining
storage is 140 GB solely from this host's 60 GiB boot disk.

The monitoring timer is running. Backup timers are not enabled; the prior handoff
records an empty backup repository. A retained recovery point and current restore
verification are required before a disruptive infrastructure change. No reboot
or filesystem expansion was performed. Running Coturn alone does not prove a
real allocation or an end-to-end camera relay stream.
