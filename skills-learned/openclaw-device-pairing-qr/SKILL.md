---
name: openclaw-device-pairing-qr
description: Generate an OpenClaw mobile pairing QR code and setup token via the /pair slash command, then walk a user through scanning it with the iOS or Android app.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-30T07:01:01.274Z
stability: experimental
---

## Workflow

1. Check gateway status before generating the QR code — run `openclaw gateway status` to confirm the gateway is connected and healthy. A down gateway will produce expired or invalid pairing tokens.
2. Detect the gateway binding mode — inspect the gateway URL (e.g. `ws://127.0.0.1:18789`). If it is loopback (`127.0.0.1`) or localhost, the QR code only works for devices on the same machine or network. Note this limitation to the user explicitly.
3. Invoke `/pair qr` in the chat — this is a runtime slash command provided by the `device-pair` plugin, not a standalone CLI binary. The command generates a QR code image and a Base64-encoded setup token.
4. Present the QR code and token together — include both the QR image and the raw `setup code` token in the response. Some mobile apps cannot scan the QR reliably (camera quality, screen glare); the token is the fallback.
5. Provide the pairing walkthrough — direct the user to: open the OpenClaw iOS or Android app → Settings → Gateway → Scan QR code or paste the setup token. Specify the expiration window (typically ~12 minutes).
6. Confirm successful pairing — after the user scans, check the pairing status with `/pair status` or `/pair pending` to confirm the device appears in the approved list. If the QR expired, re-run `/pair qr` and warn the user that old tokens are invalidated immediately upon regeneration.

## Pitfalls

- ⚠️ Gateway on loopback when the mobile app is on a different machine — the QR encodes `ws://127.0.0.1:18789` which is unreachable from the phone. The user must either enable Tailscale VPN, use the machine's LAN IP instead, or switch the gateway to bind to `0.0.0.0`.
- ⚠️ QR code expired before the user scans — the token expires in ~12 minutes. If the user delays, re-running `/pair qr` immediately invalidates the previous token. Warn them to scan promptly or have them paste the token directly.
- ⚠️ Calling `/pair qr` as a shell command instead of a chat slash command — `openclaw pair qr` in a shell will not work. The command must be invoked inside the OpenClaw chat interface where the `device-pair` plugin is active.
- ⚠️ Gateway not running when the command is issued — the plugin will return an error or empty QR. Confirm the gateway process is alive with `openclaw gateway status` before attempting pairing.
- ⚠️ Multiple pending tokens accumulate — each re-run of `/pair qr` generates a new token without revoking the old one. Use `/pair cleanup` or `/pair revoke` to clear stale tokens before issuing a fresh QR.

## Activation condition

Promote to status: active when the skill has been recalled (via skill-auto-suggest or direct invocation) ≥3 times in a rolling 7-day window with no quality regression or user override.
