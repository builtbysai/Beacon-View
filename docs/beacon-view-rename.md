# Beacon View rename — October 9, 2026

Beacon is the umbrella platform; Beacon View is the existing camera product.
The GitHub repository is now `builtbysai/Beacon-View`. Local checkout paths need
not change. The root package metadata, documentation, email copy, Android label
and wordmark, and web/PWA branding use Beacon View.

## Intentionally retained identifiers

Keep Android `com.beaconsecureview.camera`, theme identifiers, Cast namespaces,
`beaconsecureview:` desktop links, installed desktop `appId`/`productName`, and
desktop autostart filenames. They preserve installed-app identity, credentials,
pairing, deep links, and updates. A future installer branding migration needs an
explicit user-data migration; changing Electron `productName` now would unpair
existing cameras. Existing downloaded installers are not rebuilt by this rename.

Keep Compose projects `beacon-secureview-local`/`beacon-secureview-cloud`, database
names, container/volume names, `/etc/beacon`, `/opt/beacon/releases`, local secret
directories, and Tailscale hostname `beacon-secureview-oracle`. No data migration
or network change is needed. Historical shell paths and identity subjects in
handoff notes remain historical evidence.

## GitHub integration follow-up

The deployment workflow remains `disabled_manually`. GitHub confirms the renamed
immutable OIDC prefix is
`repo:builtbysai@37721651/Beacon-View@1309277283`. Update the existing Tailscale
trust subject to
`repo:builtbysai@37721651/Beacon-View@1309277283:environment:production`
before using that workflow. Preserve its audience, scopes, and network ACL.
Tailscale admin sign-in is required; manual deployment over existing SSH works.
Do not enable automatic deployment as part of this rename.

Google Cast's external console registration name and previously distributed
installers need separate verification; this source change does not alter their
identity or falsely claim new binaries have been distributed.
