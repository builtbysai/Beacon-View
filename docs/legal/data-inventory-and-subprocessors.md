# Beacon data inventory and service providers

Status: Internal factual record, reviewed **2026-09-07**. Update before changing any
provider, SDK, analytics package, notification service, or geographic availability.

| Processing activity           | Data categories                                                                           | Purpose                                                                              | Location / provider                                                             | Retention                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Account and household service | Email, password hash or Google subject, household/device IDs and settings                 | Authentication, authorization, pairing                                               | Beacon backend and PostgreSQL on Oracle Cloud Infrastructure, US East (Ashburn) | Account lifetime; production account deletion removes the account and associated service data.   |
| Device health and presence    | Device name, capabilities, version, last seen, privacy state, battery/charging            | Display and diagnose camera availability                                             | Beacon PostgreSQL on OCI                                                        | Device lifetime; device deletion removes it.                                                     |
| Live session setup            | Session state and permitted signaling                                                     | Establish a live WebRTC session                                                      | Beacon backend on OCI                                                           | In memory for active session; ends on disconnect/restart.                                        |
| Live media transport          | Encrypted packet flow; endpoint address/timing/volume may be visible to TURN when relayed | Provide direct or relayed live viewing                                               | Peer-to-peer where possible; Beacon Coturn on OCI when relayed                  | Not recorded by Beacon.                                                                          |
| Motion history                | Source ID, server timestamp, confidence                                                   | Activity display                                                                     | Beacon PostgreSQL on OCI                                                        | 1/7/30/90 days selected by household.                                                            |
| Security/audit                | IP address, event type, timestamps, related identifiers/limited metadata                  | Abuse prevention and security investigation                                          | Beacon PostgreSQL / service logs on OCI                                         | Audit events: 90 days. Infrastructure/application logs: up to 30 days.                           |
| Backups                       | Database contents, excluding live media                                                   | Recovery                                                                             | Encrypted Restic repository in private OCI Object Storage                       | 7 daily / 4 weekly / 3 monthly snapshots.                                                        |
| Google Sign-In                | OAuth code exchange and Google account identity claims                                    | Optional federated sign-in                                                           | Google                                                                          | Beacon stores only email and Google subject after verification.                                  |
| Operational and contact email | Service-health events and contact-form messages; sender email and submitted message       | Owner outage/recovery notices and response to support, privacy, or deletion requests | Resend                                                                          | Support correspondence: 24 months after matter closure; operational alerts follow log retention. |
| DNS                           | Beacon domain/IP resolution requests                                                      | Route visitors to Service                                                            | Duck DNS                                                                        | Provider-controlled; review provider terms before public launch.                                 |

## Not currently used

No advertising SDK, behavioral analytics, payment processor, cloud recording provider,
facial-recognition provider, customer-support SaaS, or web-push service is configured.

## Vendor-management actions before public launch

1. Confirm each provider's current data-processing terms, security documentation,
   geographic processing locations, retention, and incident-notice commitments.
2. Execute needed data-processing agreements after counsel determines the launch
   jurisdictions.
3. Reassess the inventory and Google Play Data Safety answers after every SDK/provider
   or feature change.
