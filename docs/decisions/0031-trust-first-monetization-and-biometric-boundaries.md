# ADR 0031: Trust-first monetization and biometric boundaries

Status: Accepted for private alpha and product direction.

## Decision

Beacon remains free during private alpha. It will not include advertising SDKs, sell or
share personal information for advertising, train AI using customer media, store cloud
video or audio, or perform facial recognition / biometric identification.

If Beacon later charges for the service, prefer a transparent subscription for clearly
defined optional service value over advertising. Do not implement billing, free trials,
or a paid tier until entitlements, cancellation, refunds, purchase restoration, privacy
disclosures, and support are designed together. The current free live-viewing service
must not be degraded with ads or data monetization.

Cloud media recording is deferred, not promised. It would require a separate approved
architecture: an explicit opt-in per camera, clear capture/retention controls,
encryption and key-management design, storage access controls, deletion and backup
semantics, cost limits, export controls, incident response, and a renewed privacy/legal
review. Person detection may be evaluated only as an on-device, feature-flagged
experiment that sends no raw frames to an AI service; facial recognition and biometric
templates remain out of scope.

## Rationale

Advertising libraries commonly introduce extra data collection and permissions,
conflicting with a security-camera product's privacy expectations. Biometric
identification carries material privacy, bias, security, and legal risks. Cloud media
would change Beacon from a live peer-to-peer service into a storage processor and
materially expands breach impact and operating cost.

## Consequences

This keeps the current public claims accurate: no cloud recordings, no face
recognition, no ads, and no AI training. Future pricing can be explored without
retrofitting a surveillance-data business model. Any exception requires a new ADR,
technical threat-model update, data-retention decision, product consent design, and
owner approval.
