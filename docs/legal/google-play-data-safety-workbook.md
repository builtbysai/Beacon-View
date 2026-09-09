# Google Play Data Safety and deletion workbook

Status: Preparation worksheet, not a Play Console submission. Revalidate against the
signed Android release and every included SDK.

Google requires every published app, including closed/open test tracks, to complete a
Data Safety form and link a privacy policy. An app that permits account creation also
needs an in-app account-deletion path and a prominent public deletion-request page.

## Initial answers to verify in Play Console

| Play data type / question                | Likely answer from current implementation                                                                                  | Purpose / notes                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the app collect or share user data? | **Yes**                                                                                                                    | Backend receives account, device, motion, security, and connection data. Service providers must be reviewed under Play definitions.                           |
| Email address                            | Collected; encrypted in transit                                                                                            | Account management and security.                                                                                                                              |
| User IDs                                 | Collected; encrypted in transit                                                                                            | Random Beacon IDs, Google subject where Google Sign-In is selected. Account management/security.                                                              |
| Device or other identifiers              | Collected; encrypted in transit                                                                                            | Installation ID and device/camera IDs for pairing and service functionality.                                                                                  |
| App activity                             | Collected; encrypted in transit                                                                                            | Motion metadata and security/audit events for functionality and fraud prevention.                                                                             |
| Photos/videos and audio files            | **Do not mark as stored files.** Reassess live WebRTC transmission against the current Play definitions before submission. | Media is captured locally and transmitted live; Beacon does not store it. The form may still require disclosure of off-device transmission.                   |
| Location                                 | Do not declare as a product feature currently. **Reassess IP-address treatment and all SDKs before filing.**               | Android does not request location permission.                                                                                                                 |
| Is data encrypted in transit?            | Yes, subject to final SDK/provider review                                                                                  | HTTPS/WSS and WebRTC DTLS-SRTP are required in production.                                                                                                    |
| Can users request deletion?              | Yes                                                                                                                        | In-app deletion and a public `/account-deletion` request route are implemented; revalidate the final release artifact and fulfillment workflow before filing. |
| Data shared with third parties?          | Review provider-by-provider                                                                                                | Oracle, Google Sign-In, Resend, and DuckDNS need classification under Play's current definitions.                                                             |

## Release evidence required

- Final public privacy-policy URL that identifies the Play developer/entity.
- Live, prominent deletion-request URL that names Beacon or the Play developer.
- In-app account-deletion route and tested fulfillment workflow.
- Released APK/AAB permission inventory and third-party SDK inventory.
- Signed owner review of every Data Safety answer.
- Target audience and content-rating decisions; current recommended launch is adults only.
