# Legal, trust, and launch decisions

These are owner decisions, not engineering choices. Recommended defaults keep Beacon a
US-only, adults-only private alpha until the product, entity, and compliance posture
mature.

| Decision                          | Recommended private-alpha default                                                                                                                                                                          | Why it matters                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Legal operator                    | Identify the individual operator or form an entity; use a business/P.O. Box address rather than publishing a home address.                                                                                 | Must appear in policies, Play developer profile, contracts, and notices.                    |
| Geography                         | **Approved: US only**; exclude EEA/UK/Switzerland and jurisdictions requiring unreviewed local surveillance/privacy work.                                                                                  | Avoids unsupported international privacy representations.                                   |
| Audience                          | **Approved: 18+ and not child-directed.**                                                                                                                                                                  | Camera/microphone use and account data make a child-focused launch materially more complex. |
| Support/privacy/security contacts | **Implemented for alpha:** a rate-limited contact form delivers privately to the owner. Move to separate owned-domain mailboxes before broader release.                                                    | Keeps the owner email off the public page while preserving a support path.                  |
| Data uses                         | **Approved:** no ads, sale, behavioral sharing, AI training, cloud media retention, or facial recognition.                                                                                                 | Matches current architecture; changes require a fresh review.                               |
| Motion retention                  | Keep user choice of 1/7/30/90 days, default 30.                                                                                                                                                            | Already implemented and privacy-preserving.                                                 |
| Audit/log retention               | **Approved:** 90-day audit/security events; 30-day infrastructure/application logs, then delete or de-identify.                                                                                            | Implemented in this milestone; deployment verification remains required.                    |
| Backups                           | Keep current 7 daily / 4 weekly / 3 monthly encrypted schedule; disclose delayed deletion from backups.                                                                                                    | Must match operational practice.                                                            |
| Account deletion                  | **Implemented for alpha:** authenticated in-app deletion after explicit confirmation and a sign-in within 10 minutes; public `/account-deletion` request route; production purge now, backup expiry later. | Add dedicated reauthentication before Play/public release.                                  |
| Access/export and correction      | Private alpha: verified manual requests. Public release: self-service export and email-change/correction flow.                                                                                             | Rights and support load.                                                                    |
| Terms                             | No fee during alpha; **New Jersey law and venue selected**.                                                                                                                                                | Final operator details and liability text remain required before publication.               |
| Incidents                         | **Approved:** Spairkie Hans Sai is private-alpha incident-response owner.                                                                                                                                  | Add backup owner/escalation contact and test a tabletop exercise before broad release.      |

## Hard blockers before broad public or Play release

1. Finalize the public legal operator and notice address. Use a business/P.O. Box address
   rather than the provided home address before publication.
2. Add dedicated reauthentication for broader/Play release.
3. Add a backup incident owner and test the incident-response tabletop exercise.
4. Publish owner-approved Privacy Policy, Terms, camera-use notice, deletion notice, and
   support/security contacts in the app and website.
5. Complete Google Play Data Safety and Data Deletion answers from the final release
   artifact and providers.
6. Establish incident response, legal review, and vendor/DPA review appropriate to the
   launch locations.
