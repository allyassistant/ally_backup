# WhatsApp Bridge for OpenClaw

## Setup Instructions

### 1. First Time Setup
```bash
./start-whatsapp.sh
```

### 2. Scan QR Code
- A QR code will appear in the terminal
- Open WhatsApp on your phone
- Go to **Settings → Linked Devices → Link a Device**
- Scan the QR code
- Wait for "✅ WhatsApp client is ready!"

### 3. Testing
Once connected, try sending a message to your WhatsApp number.
The message will be logged to `whatsapp-messages.jsonl`.

## Files
- `whatsapp-bridge.js` - Main WhatsApp client
- `start-whatsapp.sh` - Launcher script
- `whatsapp-auth/` - Authentication data (auto-created)
- `whatsapp-messages.jsonl` - Received messages log
- `whatsapp-status.json` - Connection status

## Integration with OpenClaw
After connecting, messages will be saved to `whatsapp-messages.jsonl`.
To fully integrate with OpenClaw, additional setup is needed.

## Troubleshooting

### QR Code not showing
Make sure your terminal supports QR codes. Try:
- Enlarging terminal window
- Using a different terminal app

### Connection issues
1. Check internet connection
2. Delete `whatsapp-auth/` folder and try again
3. Make sure WhatsApp on phone is updated

### Stop the bridge
Press `Ctrl+C` to stop the client gracefully.

## Security Note
- Keep `whatsapp-auth/` folder secure
- Do not share authentication files
- The session persists after restart
