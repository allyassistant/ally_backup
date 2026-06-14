#!/bin/bash
# WhatsApp Bridge Launcher

cd "$(dirname "$0")"

echo "🚀 Starting WhatsApp Bridge..."
echo ""
echo "📱 Instructions:"
echo "   1. A QR code will appear below"
echo "   2. Open WhatsApp on your phone"
echo "   3. Go to Settings → Linked Devices → Link a Device"
echo "   4. Scan the QR code"
echo "   5. Wait for '✅ WhatsApp client is ready!'"
echo ""
echo "Press Ctrl+C to stop"
echo "========================================"
echo ""

node whatsapp-bridge.js
