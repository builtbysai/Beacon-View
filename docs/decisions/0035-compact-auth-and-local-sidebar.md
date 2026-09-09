# 0035 — Compact auth and local desktop navigation preference

Date: 2026-09-07. Status: accepted within the requested web experience batch.

The supplied HTML is a visual reference. Beacon keeps its existing Paper/Evening
tokens, local/system font stack and icon vocabulary. The centered auth card is
approximately 440px wide, gives Google the first and strongest action, and keeps
the existing password login/registration form visible as a secondary path.
OAuth collision/failure messages and honest reset availability remain. No remote
font request, auth endpoint change, account-linking or reset capability is added.

Desktop navigation can collapse to icons with accessible names and focus/hover
labels. The single versioned `beacon.sidebar.collapsed.v1` browser preference
contains only a Boolean; it is a device presentation setting, shared across
accounts on that browser. Storage failure falls back to usable navigation.
Mobile keeps its labeled bottom navigation regardless of the stored preference.
No server preference or additional dependency is introduced.

Viewport fixes bound symbolic surfaces and live stages instead of hiding document
overflow. Actual forms, lists, expanded options and legal text may scroll. The
Monitor toolbar reorganization does not change workspace data, playback capacity,
media consent or connection lifetimes. Native multi-camera playback remains out
of scope. See [the audit](../responsive-audit.md) for evidence and limitations.
