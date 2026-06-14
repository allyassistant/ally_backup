/**
 * Skill: WhatsApp Notification
 * 功能: 發送 WhatsApp 通知
 */

const SKILL = {
  name: "whatsapp_notification",
  keywords: ["whatsapp", "message", "通知", "send", "發送", "notify"],
  intents: ["send_notification", "send_message", "發通知"],
  description: "發送 WhatsApp 通知"
};

function sendWhatsApp(to, message) {
  return {
    skill: "whatsapp_notification",
    action: "send",
    to: to,
    message: message?.substring(0, 50),
    messageId: `msg_${Date.now()}`,
    status: "queued"
  };
}

function broadcast(message, recipients) {
  return {
    skill: "whatsapp_notification",
    action: "broadcast",
    recipients: recipients?.length || 0,
    message: message?.substring(0, 50),
    status: "queued"
  };
}

function sendReminder(to, reminder, time) {
  return {
    skill: "whatsapp_notification",
    action: "reminder",
    to: to,
    reminder: reminder,
    scheduledTime: time,
    status: "scheduled"
  };
}

module.exports = { skill: SKILL, sendWhatsApp, broadcast, sendReminder };
