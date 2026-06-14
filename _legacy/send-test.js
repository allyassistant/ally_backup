const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-auth' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('ready', async () => {
    console.log('✅ Ready to send message');
    
    // Send test message to Josh
    const chatId = '852XXXXXXX@c.us'; // Josh's number format
    const message = `🤖 *Ally (AI Assistant) 已連接 WhatsApp*

你好 Josh！

我而家可以透過 WhatsApp 同你溝通。你可以：
• 直接發訊息俾我
• 我會自動回覆確認收到
• 複雜問題我會記錄並盡快處理

請回覆 "Hello" 測試連接！`;
    
    try {
        await client.sendMessage(chatId, message);
        console.log('✅ Message sent successfully!');
    } catch (err) {
        console.error('❌ Failed to send:', err.message);
    }
    
    setTimeout(() => {
        client.destroy();
        process.exit(0);
    }, 5000);
});

client.initialize();
