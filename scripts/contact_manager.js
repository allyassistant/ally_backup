#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * 人際資源庫管理器
 * Contact/Relationship Database Manager
 *
 * 功能：管理客戶、供應商、中介等聯絡資料
 */

const fs = require('fs');
const path = require('path');

const { MEMORY_DIR } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const CONTACTS_FILE = path.join(MEMORY_DIR, 'contacts', 'contacts.json');

// 聯絡人類型
const CONTACT_TYPES = {
  CLIENT: '客戶',
  SUPPLIER: '供應商',
  BROKER: '中介',
  PARTNER: '合作夥伴',
  OTHER: '其他'
};

/**
 * 加載聯絡人數據
 */
function loadContacts() {
  try {
    try {
      return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    } catch (e) {
      console.error('⚠️ Failed to parse contacts file:', e.message);
      return { contacts: [], groups: [] };
    }
  } catch {
    return { contacts: [], lastUpdated: getHKTDateTime() };
  }
}

/**
 * 保存聯絡人數據
 */
function saveContacts(data) {
  data.lastUpdated = getHKTDateTime();
  try {
    const tmpPath = CONTACTS_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, CONTACTS_FILE);
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }
}

/**
 * 添加聯絡人
 */
function addContact(contact) {
  const data = loadContacts();

  const newContact = {
    id: Date.now().toString(36),
    name: contact.name,
    type: contact.type || CONTACT_TYPES.OTHER,
    phone: contact.phone || '',
    email: contact.email || '',
    company: contact.company || '',
    relationship: contact.relationship || 5, // 1-10 關係度
    lastContact: contact.lastContact || getHKTDateTime(),
    notes: contact.notes || '',
    tags: contact.tags || [],
    createdAt: getHKTDateTime()
  };

  data.contacts.push(newContact);
  saveContacts(data);

  return { success: true, contact: newContact };
}

/**
 * 查詢聯絡人
 */
function findContacts(query) {
  const data = loadContacts();

  if (!query) return data.contacts;

  return data.contacts.filter(c =>
    c.name.includes(query) ||
    c.company.includes(query) ||
    c.tags.some(t => t.includes(query)) ||
    c.notes.includes(query)
  );
}

/**
 * 更新聯絡人
 */
function updateContact(id, updates) {
  const data = loadContacts();
  const index = data.contacts.findIndex(c => c.id === id);

  if (index === -1) {
    return { success: false, error: 'Contact not found' };
  }

  data.contacts[index] = { ...data.contacts[index], ...updates };
  data.contacts[index].lastContact = getHKTDateTime();

  saveContacts(data);
  return { success: true, contact: data.contacts[index] };
}

/**
 * 刪除聯絡人
 */
function deleteContact(id) {
  const data = loadContacts();
  data.contacts = data.contacts.filter(c => c.id !== id);
  saveContacts(data);
  return { success: true };
}

/**
 * 獲取統計數據
 */
function getStats() {
  const data = loadContacts();
  const stats = {
    total: data.contacts.length,
    byType: {}
  };

  for (const type of Object.values(CONTACT_TYPES)) {
    stats.byType[type] = data.contacts.filter(c => c.type === type).length;
  }

  return stats;
}

/**
 * 顯示聯絡人列表（格式化）
 */
function listContacts(type = null) {
  const data = loadContacts();
  let contacts = data.contacts;

  if (type) {
    contacts = contacts.filter(c => c.type === type);
  }

  log(`\n📇 聯絡人列表 (${contacts.length} 位)\n`);
  log('=' .repeat(60));

  for (const c of contacts) {
    log(`\n👤 ${c.name}`);
    log(`   類型：${c.type}`);
    log(`   電話：${c.phone || 'N/A'}`);
    log(`   公司：${c.company || 'N/A'}`);
    log(`   關係度：${'⭐'.repeat(c.relationship)}${'⚫'.repeat(10-c.relationship)}`);
    if (c.notes) log(`   備註：${c.notes}`);
  }

  log('\n' + '='.repeat(60));
}

// CLI
if (require.main === module) {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'add':
      log('添加聯絡人：');
      log('Usage: node contact_manager.js add');
      break;

    case 'list':
      listContacts(args[0]);
      break;

    case 'find':
      const results = findContacts(args.join(' '));
      log(JSON.stringify(results, null, 2));
      break;

    case 'stats':
      log(JSON.stringify(getStats(), null, 2));
      break;

    default:
      log(`
聯絡人管理器

Usage:
  node contact_manager.js add          - 添加聯絡人
  node contact_manager.js list [type]  - 列出聯絡人
  node contact_manager.js find [query] - 查詢聯絡人
  node contact_manager.js stats        - 統計數據

類型：客戶、供應商、中介、合作夥伴、其他
      `);
  }
}

module.exports = {
  addContact,
  findContacts,
  updateContact,
  deleteContact,
  getStats,
  CONTACT_TYPES
};
