const fs = require('fs');
const path = './whatsapp-command.json';

if (!fs.existsSync(path)) {
    console.log('No command file found');
    process.exit(0);
}

const command = JSON.parse(fs.readFileSync(path, 'utf8'));

if (command.type === 'send' && command.to && command.message) {
    // This will be picked up by the running bot
    console.log(JSON.stringify(command));
    fs.unlinkSync(path);
} else {
    console.log('Invalid command');
}
