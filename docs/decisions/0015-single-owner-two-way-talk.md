# 0015: Single-owner two-way talk

## Status

Accepted for the first two-way audio slice.

## Decision

An authenticated live viewer may explicitly request a talk channel for its existing
connection. The signaling server grants at most one connection per camera and reports
a busy state to later requests. Ownership ends on release, viewer disconnect, camera
disconnect, source change, or privacy mode.

The web viewer asks for microphone permission only after Talk is selected. It negotiates
an audio return track, requests the server lock, and stops every local microphone track
when talk ends or the view unmounts. Android negotiates a receive-only audio transceiver
and keeps the received track disabled until the server grants that exact connection.
Audible tones indicate talk start and end near the camera device.

## Consequences

Listen and Talk remain independent. A viewer can stop incoming camera audio while still
talking, and opening Live View never activates the viewer microphone. This first slice
uses an explicit Talk / Stop talking interaction so it remains keyboard and assistive-
technology accessible. Press-and-hold behavior may be added as an enhancement after
pointer-cancellation and permission-prompt behavior are tested.

Physical echo, speaker volume, audio routing, Bluetooth behavior, and poor-network
quality still require device acceptance. Android Monitor-to-camera talk is not included
in this slice.
