const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-auth' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('QR received (already authenticated)');
});

client.on('ready', () => {
    console.log('✅ Ready at', new Date().toISOString());
    console.log('Info:', client.info);
});

// Try different message events
client.on('message_create', (msg) => {
    console.log('\n📨 message_create event:');
    console.log('  From:', msg.from);
    console.log('  Body:', msg.body);
    console.log('  From me:', msg.fromMe);
});

client.on('message', (msg) => {
    console.log('\n📩 message event:');
    console.log('  From:', msg.from);
    console.log('  Body:', msg.body);
});

client.on('message_received', (msg) => {
    console.log('\n📥 message_received event:');
    console.log('  From:', msg.from);
    console.log('  Body:', msg.body);
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth failure:', msg);
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Disconnected:', reason);
});

console.log('🚀 Starting test client...');
client.initialize();
