# Support, deletion, and privacy-request procedure

Status: Internal operating draft. The private-alpha contact form is live; public policy
and owned-domain mailboxes remain a broader-release requirement.

## Public contacts to establish

| Purpose              | Publish as                                      | Required owner action                                                         |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| General support      | **[support@owned-domain]**                      | Create monitored mailbox and response owner.                                  |
| Privacy and deletion | **[privacy@owned-domain]**                      | Create monitored mailbox; publish in policy and deletion page.                |
| Security reports     | **[security@owned-domain]**                     | Create monitored mailbox or managed disclosure form. Do not promise a bounty. |
| Legal notices        | **[legal entity and physical mailing address]** | Select legal operator and address appropriate for notices.                    |

DuckDNS is not suitable for email identity. For private alpha, the rate-limited Beacon
contact form delivers privately to the designated owner without publishing a mailbox.
Before broader release, move to an owned domain with SPF, DKIM, and DMARC and publish
separately monitored support, privacy, and security routes.

## Intake and identity verification

1. Log the request ID, date, request type, account email, requested scope, and handler.
   Do not copy passwords, tokens, live-media content, pairing codes, or government ID
   into the ticket.
2. For an authenticated request, require recent session reauthentication before a
   destructive action. For an emailed request, send a confirmation link to the account
   email or require an equivalent account-control verification.
3. For an authorized agent, verify the agent's authority and the account holder's
   identity before disclosing or deleting information.
4. Acknowledge receipt within **[ADOPTED TARGET]** and record the deadline calculated
   under the applicable law. Escalate requests from jurisdictions outside the approved
   launch area to counsel.

## Request handling

| Request                 | Current fulfillment path                                                                                                                                   | Gap                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Device deletion         | Authenticated owner deletes a device in the Service.                                                                                                       | Available.                                                        |
| Motion-history deletion | Authenticated owner clears household motion history.                                                                                                       | Available.                                                        |
| Session revocation      | Authenticated owner revokes listed browser sessions.                                                                                                       | Available.                                                        |
| Account deletion        | Authenticated in-app deletion after an explicit confirmation and a sign-in within 10 minutes; a public `/account-deletion` request form is also available. | Add a dedicated reauthentication flow before public/Play release. |
| Access/export           | No account export feature.                                                                                                                                 | Define scope and build or handle manually for private alpha.      |
| Correction              | Account email correction flow is not defined.                                                                                                              | Define before public release.                                     |

## Security incident response, minimum procedure

**Private-alpha incident-response owner:** Spairkie Hans Sai. The owner must maintain
access to the contact-delivery inbox and production incident runbook. Before broader
release, designate a backup owner and a legal/escalation contact.

1. Triage, preserve relevant non-sensitive logs, and stop exposure (revoke credentials,
   disable service, rotate secrets, or isolate systems as appropriate).
2. Record scope, affected data categories, systems, time window, remediation, and
   decisions. Do not include secrets in the incident record.
3. Consult qualified counsel on notification obligations for affected people,
   regulators, insurers, and service providers; requirements vary by location.
4. Notify affected people with factual, non-speculative information when required or
   appropriate; document delivery.
5. Complete a post-incident review and corrective actions before closure.
