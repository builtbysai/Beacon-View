# ADR 0022: Device health telemetry

Status: Accepted.

Android reports battery percentage and charging state with its existing authenticated
heartbeat. The backend accepts only a complete, bounded pair, stores the latest sample
on the paired device, and returns it only to the owning household. Older clients may
send an empty heartbeat and keep their prior health sample. Beacon does not infer
battery, temperature, signal, or permissions from missing data.

Battery health does not affect capture authorization or privacy. It is advisory status
only. Schema migrations must complete before a backend version that writes new telemetry
is started; production deployment already requires a separate migration job.
