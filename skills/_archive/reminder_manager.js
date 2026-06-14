/**
 * Skill: Reminder Manager
 * 功能: 設定提醒事項
 */

const SKILL = {
  name: "reminder_manager",
  keywords: ["reminder", "提醒", "alarm", "通知", "待辦", "todo"],
  intents: ["set_reminder", "create_reminder", "設定提醒"],
  description: "設定提醒事項"
};

function setReminder(task, time, options = {}) {
  return {
    skill: "reminder_manager",
    action: "set",
    task: task,
    time: time,
    recurring: options.recurring || false,
    priority: options.priority || "normal",
    reminderId: `rem_${Date.now()}`
  };
}

function listReminders(filter = {}) {
  return {
    skill: "reminder_manager",
    action: "list",
    filter: filter,
    message: "📋 Listing reminders..."
  };
}

function completeReminder(reminderId) {
  return {
    skill: "reminder_manager",
    action: "complete",
    reminderId: reminderId,
    status: "completed"
  };
}

function snoozeReminder(reminderId, newTime) {
  return {
    skill: "reminder_manager",
    action: "snooze",
    reminderId: reminderId,
    newTime: newTime,
    status: "snoozed"
  };
}

module.exports = { skill: SKILL, setReminder, listReminders, completeReminder, snoozeReminder };
