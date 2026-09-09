# Beacon SecureView Privacy Policy

Effective date: **[DATE]**

> Draft only. Replace every bracketed field and obtain legal review before publication.

Beacon SecureView ("Beacon," "we," "us," and "our") is operated by **[LEGAL
ENTITY / INDIVIDUAL NAME]**, located at **[BUSINESS ADDRESS]**. This Privacy Policy
explains how we handle information when you use the Beacon SecureView website,
Android app, and related live-camera service (collectively, the "Service"). Contact
us at **[PRIVACY CONTACT EMAIL]**.

## At a glance

- Beacon is a live-viewing service. We do not provide cloud recording, upload camera
  video or audio for storage, perform facial recognition, or sell personal information.
- Live media is sent using WebRTC. A connection may be direct between your devices or
  pass through our TURN relay when a direct route is unavailable. We do not configure
  the relay to record media.
- Motion history contains on-device scene-change metadata, not clips, thumbnails, or
  pixel samples. You choose a 1, 7, 30, or 90 day motion-metadata retention period.
- Camera and microphone capture are visible on the Android camera device and can be
  stopped with Privacy mode. Remote Privacy mode takes effect when the device receives
  the command; network loss can delay a remote command. The device also has a local,
  fail-closed privacy control.

## Information we process

| Category                         | Examples                                                                                                                                                                    | Why we use it                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Account information              | Email address; Google account subject identifier when you choose Google Sign-In; password hash when you use a password                                                      | Create and secure your account, authenticate you, and prevent abuse. We do not store your plaintext password.                                 |
| Session and security information | Hashed browser-session and CSRF tokens, login and security audit events, IP address, request timing                                                                         | Keep the Service secure, investigate misuse, and operate sessions.                                                                            |
| Device and camera information    | Device and camera names, random public IDs, installation identifier, platform, source/facing details, capabilities, software version, enabled/privacy state, last-seen time | Pair devices, show them in your household, establish live viewing, and provide support.                                                       |
| Device health                    | Battery percentage, charging status, and report time when an Android camera reports them                                                                                    | Show device-health status and help diagnose availability.                                                                                     |
| Motion metadata                  | Camera source, timestamp, and confidence from on-device scene-change detection                                                                                              | Show activity history and enforce your chosen retention setting. No video, audio, thumbnail, or pixel sample is sent as part of this feature. |
| Live connection information      | Signaling messages needed to set up WebRTC; connection state; short-lived TURN credentials                                                                                  | Establish and secure a live session. We do not log SDP, ICE candidates, TURN credentials, or media payloads in Beacon application logs.       |
| Support correspondence           | Information you choose to send to support                                                                                                                                   | Respond to your request and maintain a support record.                                                                                        |

We do not intentionally collect precise location, contacts, payment information,
advertising identifiers, or biometric identifiers. We do not use camera or microphone
media for advertising, profiling, or training an AI model.

## How live media works

Your Android camera device captures video and, only where enabled and permitted, audio.
WebRTC encrypts media in transit using DTLS-SRTP. Our server authorizes a session and
exchanges signaling needed to establish it. Most sessions are peer-to-peer. If a direct
route is not possible, our TURN relay forwards encrypted packets. A relay can observe
connection endpoints, timing, and traffic volume; it is not configured to decrypt or
record the media. This architecture is not a claim of application-level end-to-end
encryption.

## How we use and disclose information

We use information to provide the Service, authenticate and authorize users and
devices, prevent fraud and abuse, maintain security, respond to support requests, and
comply with law. We disclose information only to service providers that operate the
Service on our behalf, when you direct us to do so, or where disclosure is required by
law.

We do not sell or share personal information for cross-context behavioral advertising.
We do not permit third parties to use Beacon data for their own marketing.

## Service providers and transfers

Beacon currently uses Oracle Cloud Infrastructure for the US-hosted application,
database, TURN relay, and encrypted backup storage; Google for optional Google
Sign-In; Duck DNS for the Service's domain name; and Resend for owner operational
alerts. Provider handling is subject to their own agreements and policies.

The Service is initially offered only in **[APPROVED COUNTRIES / US STATES]** and is
hosted in the United States. Do not offer it in the EEA, UK, Switzerland, or other
regions until the applicable controller, transfer, legal-basis, and representative
requirements have been reviewed.

## Retention and deletion

Motion metadata is retained for the household period you select: 1, 7, 30, or 90 days.
Expired motion metadata is excluded immediately and deleted by a scheduled backend
job. You may also clear household motion history.

Security/audit events are retained for 90 days; infrastructure and application logs are
retained for up to 30 days; and support correspondence is retained for 24 months after
the matter is closed. Account deletion is described in our [Data Retention and Deletion
Notice](LINK TO PUBLISHED NOTICE). Encrypted backups may retain a deleted record until
the applicable backup snapshots expire.

## Your choices and rights

You can control camera enablement, camera deletion, Privacy mode, session revocation,
and motion-metadata retention in the Service. To request access, correction, deletion,
or a copy of your information, use **[PUBLISHED PRIVACY CONTACT FORM OR EMAIL]**. We may need to verify your identity before acting. We will not
discriminate against you for exercising applicable privacy rights.

California residents may have rights to know, correct, delete, opt out of sale or
sharing, limit certain sensitive-information uses, and receive non-discriminatory
treatment, subject to applicable law and exceptions. Beacon does not sell or share
personal information for cross-context behavioral advertising. An authorized agent may
submit a request through **[PUBLISHED PRIVACY CONTACT FORM OR EMAIL]**; we will verify
both the agent's authority and the consumer's identity as appropriate.

## Security

We use measures designed to protect information, including HTTPS/WSS in production,
encrypted WebRTC media transport, hashed credentials and sessions, access controls,
and encrypted off-VM backups. No method of transmission or storage is completely
secure. Please protect your account, paired devices, and home network.

## Children

The Service is not directed to children and is not for use by anyone under **[AGE,
RECOMMENDED: 18]**. We do not knowingly collect personal information from children. If
you believe a child has provided information to us, use **[PUBLISHED PRIVACY CONTACT
FORM OR EMAIL]**.

## Changes and contact

We will post the updated policy and revise the effective date before a material change
takes effect. For questions or complaints, use **[PUBLISHED PRIVACY CONTACT FORM OR
EMAIL]** or write to **[LEGAL ENTITY AND BUSINESS ADDRESS]**.
