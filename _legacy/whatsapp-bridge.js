const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// WhatsApp Client Configuration
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './whatsapp-auth'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Generate QR code for pairing
client.on('qr', (qr) => {
    console.log('\n========================================');
    console.log('📱 SCAN THIS QR CODE WITH WHATSAPP');
    console.log('========================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\nWaiting for connection...\n');
});

// Ready event
client.on('ready', () => {
    console.log('\n✅ WhatsApp client is ready!\n');
    console.log('You can now receive messages from WhatsApp.');
    
    // Save connection status
    fs.writeFileSync('./whatsapp-status.json', JSON.stringify({
        connected: true,
        readyAt: new Date().toISOString()
    }));
});

// Message received event - forward to OpenClaw
client.on('message_create', async (msg) => {
    // Ignore own messages (from this client)
    if (msg.fromMe) return;
    
    console.log(`\n📨 New message from ${msg.from}:`);
    console.log(`   ${msg.body}\n`);
    
    // Save message for processing
    const messageData = {
        from: msg.from,
        body: msg.body,
        timestamp: msg.timestamp,
        receivedAt: new Date().toISOString()
    };
    
    fs.appendFileSync('./whatsapp-messages.jsonl', JSON.stringify(messageData) + '\n');
    
    // TODO: Integrate with OpenClaw to forward message
    // For now, just log it
});

// Handle disconnect
client.on('disconnected', (reason) => {
    console.log('\n⚠️ WhatsApp client disconnected:', reason);
    fs.writeFileSync('./whatsapp-status.json', JSON.stringify({
        connected: false,
        disconnectedAt: new Date().toISOString(),
        reason: reason
    }));
});

// Error handling
client.on('auth_failure', (msg) => {
    console.error('\n❌ Authentication failure:', msg);
});

// Start client
console.log('🚀 Starting WhatsApp client...\n');
client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down WhatsApp client...');
    await client.destroy();
    process.exit(0);
});
