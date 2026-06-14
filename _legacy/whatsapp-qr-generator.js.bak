const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-auth' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', async (qr) => {
    console.log('📱 QR Code received, generating image...');
    
    // Save QR code to file
    fs.writeFileSync('./whatsapp-qr.txt', qr);
    
    // Generate PNG image
    await QRCode.toFile('./whatsapp-qr.png', qr, {
        width: 800,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    });
    
    console.log('✅ QR Code saved to: whatsapp-qr.png');
    console.log('📁 Also saved as text: whatsapp-qr.txt');
    console.log('\nPlease scan the image file.');
});

client.on('ready', () => {
    console.log('\n✅ WhatsApp client is ready!');
    fs.writeFileSync('./whatsapp-status.json', JSON.stringify({
        connected: true,
        readyAt: new Date().toISOString()
    }));
});

client.on('disconnected', () => {
    console.log('\n⚠️ Disconnected');
});

console.log('🚀 Starting WhatsApp client...\n');
client.initialize();
