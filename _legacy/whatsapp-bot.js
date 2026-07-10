const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const { exec } = require('child_process');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-auth' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

// Josh's WhatsApp number (for reference)
const JOSH_NUMBER = process.env.JOSH_NUMBER || '+852XXXXXXXX'; // from env

client.on('qr', async (qr) => {
    console.log('📱 QR Code received, generating image...');
    fs.writeFileSync('./whatsapp-qr.txt', qr);
    await QRCode.toFile('./whatsapp-qr.png', qr, { width: 800, margin: 2 });
    console.log('✅ QR Code saved to: whatsapp-qr.png');
});

client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    fs.writeFileSync('./whatsapp-status.json', JSON.stringify({
        connected: true,
        readyAt: new Date().toISOString()
    }));
    
    // Check for pending commands every 5 seconds
    setInterval(async () => {
        if (fs.existsSync('./whatsapp-command.json')) {
            try {
                const cmd = JSON.parse(fs.readFileSync('./whatsapp-command.json', 'utf8'));
                if (cmd.type === 'send' && cmd.to && cmd.message) {
                    const chatId = cmd.to.includes('@') ? cmd.to : `${cmd.to}@c.us`;
                    await client.sendMessage(chatId, cmd.message);
                    console.log(`✅ Command: Message sent to ${cmd.to}`);
                    fs.unlinkSync('./whatsapp-command.json');
                }
            } catch (err) {
                console.error('Command error:', err.message);
            }
        }
    }, 5000);
    
    // Send startup message
    const infoMessage = `🤖 *Ally (AI Assistant) 已上線*

你好 Josh！我而家已經連接到 WhatsApp。
你可以直接喺呢度同我傾偈，我會盡快回覆。

時間：${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`;
    
    // Send to Josh after 3 seconds
    setTimeout(() => {
        client.sendMessage('852XXXXXXX@c.us', infoMessage).catch(console.error);
    }, 3000);
});

client.on('message_create', async (msg) => {
    // Ignore own messages
    if (msg.fromMe) return;
    
    const sender = msg.from;
    const senderName = msg._data.notifyName || 'Unknown';
    const body = msg.body;
    const timestamp = new Date(msg.timestamp * 1000).toISOString();
    
    console.log(`\n📨 [${timestamp}] Message from ${senderName} (${sender}):`);
    console.log(`   ${body}\n`);
    
    // Save message
    const messageData = {
        from: sender,
        fromMe: false,
        senderName: senderName,
        body: body,
        timestamp: msg.timestamp,
        receivedAt: new Date().toISOString()
    };
    fs.appendFileSync('./whatsapp-messages.jsonl', JSON.stringify(messageData) + '\n');
    
    // Auto-reply for testing
    if (body.toLowerCase().includes('hello') || body.toLowerCase().includes('hi')) {
        const reply = `你好 ${senderName}！👋\n\n我係 Ally，Josh 嘅 AI 助理。我有收到你嘅訊息，會盡快回覆！`;
        await msg.reply(reply);
        console.log('✅ Auto-reply sent');
    }
    else if (body.includes('?') || body.includes('？')) {
        const reply = `收到你嘅問題，我而家處理緊，請稍等... ⏳`;
        await msg.reply(reply);
        console.log('✅ Acknowledgment sent');
    }
    else {
        const reply = `收到！✅\n\n我會轉達俾 Josh，或者你有咩需要幫手都可以直接講。`;
        await msg.reply(reply);
        console.log('✅ Acknowledgment sent');
    }
});

client.on('disconnected', () => {
    console.log('⚠️ WhatsApp disconnected');
    fs.writeFileSync('./whatsapp-status.json', JSON.stringify({
        connected: false,
        disconnectedAt: new Date().toISOString()
    }));
});

console.log('🚀 Starting WhatsApp client...');
client.initialize();

process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down...');
    await client.destroy();
    process.exit(0);
});
