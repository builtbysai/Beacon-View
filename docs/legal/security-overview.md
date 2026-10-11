# Beacon security overview

Status: Draft public trust page copy. It intentionally describes controls without
claiming certification, zero risk, or end-to-end encryption.

Beacon is designed so your camera device and viewer can establish a low-latency live
connection without Beacon storing the live stream. Production connections use HTTPS and
WSS; live WebRTC media uses encrypted DTLS-SRTP transport. When a direct connection
cannot be made, Beacon's TURN relay forwards encrypted packets. The relay is not
configured to record or decrypt media, but it can observe connection metadata such as
endpoints, timing, and traffic volume.

Optional clips are encrypted on the camera device before they are saved to the owner’s
own Google Drive. Beacon’s server holds the key for each clip, wrapped with a server key,
so that it can play a clip back to an authorized household member. Google cannot read the
clip; Beacon’s server can, so this is not end-to-end encryption.

We use hashed passwords and session/device credentials, per-device pairing,
authorization checks for camera access, short-lived TURN credentials, local Android
capture indicators, and controls to revoke sessions or delete devices. Privacy mode
stops capture locally; a remote privacy request needs the device to be online to arrive.

No security system is perfect. Beacon is a private alpha, not a monitored alarm
service. Please secure your account, Android device, and local network. To report a
security issue, contact **[SECURITY EMAIL OR REPORTING URL]**. Do not send passwords,
tokens, pairing codes, or private media by email.
