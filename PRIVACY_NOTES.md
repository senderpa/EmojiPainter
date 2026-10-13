# Privacy Notes (for this codebase)

This describes how the **code in this repository** handles data. It is not a legal privacy policy
for the live emojipainter.com service (that lives at emojipainter.com and is out of scope for this
repo).

## On-device by default

- Front-camera face tracking (ARKit `ARFaceAnchor`) and RoomPlan room-mesh capture run entirely
  on-device. The native AR modules do not transmit raw camera frames or face geometry anywhere.
- The 2D canvas, vector mode, and animator never touch the network unless the user explicitly
  saves/uploads/exports.

## What leaves the device, and when

Only explicit user actions produce outbound data, and only to the backend you configure (see
`docs/BUILDING.md`):
- Taking a selfie for the face-paint feature
- Saving/uploading a painting to the gallery
- Saving a room (RoomPlan capture + strokes) for later reopening
- Social actions (follow, profile updates) if the community backend is configured

## Identity model

Users are identified by a locally-generated, locally-persisted device identifier (not an
email/password account). If you deploy your own backend, you're responsible for how you store and
protect that data, and for your own user-facing privacy policy — this file only describes what the
open-source client code does.

## Children

This app has no account requirement and no age gate in the client code. If you deploy a public
instance, you are responsible for evaluating your own regulatory obligations (e.g. COPPA) — this
repository makes no claims about compliance.
