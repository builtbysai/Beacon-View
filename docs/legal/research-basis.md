# Research basis for Beacon's legal and trust package

Reviewed: 2026-09-07. This is product research, not legal advice.

- [Google Play Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469) says published apps must complete Data Safety information and link a privacy policy; the disclosure must account for third-party code and data handling.
- [Google Play account-deletion guidance](https://support.google.com/googleplay/android-developer/answer/13327111) says apps that allow account creation must provide an in-app deletion path and a prominent public deletion-request path, subject to limited exemptions.
- [Google Play User Data / prominent disclosure guidance](https://support.google.com/googleplay/android-developer/answer/11150561) requires a privacy policy in Play Console and in-app when personal or sensitive user data is accessed, collected, used, or shared, and explains when just-in-time disclosure is needed.
- [California DOJ CCPA overview](https://oag.ca.gov/privacy/ccpa) describes rights to know, delete, opt out, and non-discrimination, plus CPRA additions. Counsel must determine whether Beacon is a covered business and which state laws apply.
- [ICO right-to-be-informed guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/) describes clear, timely privacy information, purposes, retention, recipients, and other required notice elements for UK GDPR contexts. It supports excluding EEA/UK launches until a jurisdiction review is complete.
- [FTC small-business cybersecurity guidance](https://www.ftc.gov/business-guidance/small-businesses/cybersecurity) recommends safeguarding data, regular backups, access controls, incident planning, and notifying affected parties when appropriate. It informs the internal incident procedure but does not replace state-by-state notification analysis.
- [FTC biometric-information policy statement](https://www.ftc.gov/legal-library/browse/policy-statement-federal-trade-commission-biometric-information-section-5-federal-trade-commission) and [FTC facial-recognition guidance](https://www.ftc.gov/news-events/news/press-releases/2012/10/ftc-recommends-best-practices-companies-use-facial-recognition-technologies) identify privacy, bias, accuracy, notice, consent, security, and deletion risks. They support Beacon's permanent no-facial-recognition boundary.
- [FTC guidance for app developers using ad libraries](https://www.ftc.gov/business-guidance/blog/2016/09/ad-libraries-app-developers-check-out-advice) notes that ad libraries can add data collection, permissions, and privacy obligations. This supports a no-ad security-camera experience.
- [Android Play Billing subscription guidance](https://developer.android.com/google/play/billing/subscriptions) describes entitlement, renewal, trial, and restoration behavior. It supports deferring billing until those systems and customer terms are designed.

The next legal review should use the final entity, locations, business model, exact
providers/SDKs, and all live data flows. Laws and platform requirements change; verify
them again before public release.
