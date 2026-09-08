# 0038 — Responsive landing, native modal and Android entry choice

Date: 2026-09-08. Status: accepted within the requested experience milestone.

The signed-out web experience uses a two-panel landing page where space permits and
the compact authentication card alone on phone and tablet widths. The supplied SVG
is the canonical mark for this surface. The password path remains visible alongside
Google sign-in. Forgot password reports the current reset limitation and links to
support because the backend has no approved reset-token and email-delivery flow.
Adding a control that implies an unavailable reset would be misleading.

Desktop navigation follows the existing adaptive rail model: expanded labels at
normal width, an icon rail with focus and hover labels when collapsed, a small edge
chevron, and a fixed labeled bottom bar on narrow screens. The collapsed preference
remains local presentation state. Product status copy, household helper copy and
promotional footer copy are removed from the rail.

Pairing uses the platform `dialog.showModal()` behavior. This contains initial focus,
makes the rest of the document inert, supports Escape dismissal, and adds a blurred
backdrop. The dialog owns short-screen overflow when its content cannot fit.

An unpaired Android installation opens on a light Welcome screen. Camera setup and
Monitor sign-in are explicit choices before pairing. Beginning setup is remembered,
incoming verified pairing links bypass Welcome, and Back returns to it. This state
does not start camera capture. Compact-height spacing keeps the complete Welcome
screen inside a landscape phone viewport while retaining scroll fallback for larger
text and unusually small windows.
