#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// ==================== HKT TIME HELPER ====================
/**
 * Heartbeat 漸進式回憶系統
 *
 * 功能：
 * - 每次 heartbeat 記錄對話 key topics（50字內）
 * - 分級回憶：每1次快速摘要、每3次今日重點、每6次本週相關
 * - 自動讀取今日 memory 文件提取重點
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_DIR = path.join(process.cwd(), 'memory');
const CONTEXT_FILE = path.join(MEMORY_DIR, 'heartbeat-context.json');

// P2 Fix: CONFIG for magic numbers
const CONFIG = {
    MAX_SUMMARY_LENGTH: 50,
    MAX_TOPICS: 8,
    MAX_HIGHLIGHTS: 10,
    MAX_WEEKLY: 20,
};

const MAX_SUMMARY_LENGTH = CONFIG.MAX_SUMMARY_LENGTH; // Backward compat
const { getHKTDate } = require('./lib/time');

// 確保目錄存在
try {
    if (!fs.existsSync(MEMORY_DIR)) {
        try {
            fs.mkdirSync(MEMORY_DIR, { recursive: true });
        } catch (e) {
            console.error('⚠️ mkdir failed: ' + e.message);
            return;
        }
    }
} catch (e) {
    console.error('Error checking file: ' + e.message);
    return;
}

// 初始化或讀取狀態
function loadContext() {
    try {
        if (fs.existsSync(CONTEXT_FILE)) {
            let data;
            try {
                data = fs.readFileSync(CONTEXT_FILE, 'utf8');
            } catch (e) {
                console.error('Error reading file: ' + e.message);
                return null;
            }
            try {
                return JSON.parse(data);
            } catch (e) {
                console.error('⚠️ Failed to parse context file:', e.message);
                return null;
            }
        }
    } catch (e) {
        console.error('讀取 context 失敗，重新初始化:', e.message);
    }
    return {
        initializedAt: new Date().toISOString(),
        heartbeatCount: 0,
        currentSession: {
            topics: [],
            lastSummary: null,
            lastUpdate: null
        },
        todayHighlights: [],
        weeklyTopics: [],
        recallHistory: []
    };
}

// 儲存狀態 (atomic write)
function saveContext(context) {
    try {
        const content = JSON.stringify(context, null, 2);
        const tmpPath = CONTEXT_FILE + '.tmp';
        try {
            fs.writeFileSync(tmpPath, content, 'utf8');
            fs.renameSync(tmpPath, CONTEXT_FILE);
        } catch (e) {
            console.error('Error writing file: ' + e.message);
            return;
        }
    } catch (e) {
        console.error('Error writing file: ' + e.message);
        return;
    }
}

// 獲取今日日期 (YYYY-MM-DD)
function getToday() {
    return getHKTDate();
}

// 獲取本週開始日期 (星期日) - P2 Fix: Use HKT timezone consistently
function getWeekStart() {
    const now = new Date();
    // Use HKT timezone for consistency with getToday()
    const hktDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
    const hktDate = new Date(hktDateStr + 'T00:00:00+08:00');
    const dayOfWeek = hktDate.getDay(); // 0 = Sunday
    const weekStart = new Date(hktDate);
    weekStart.setDate(hktDate.getDate() - dayOfWeek);
    return weekStart.toISOString().split('T')[0];
}

// 讀取今日 memory 文件
function readTodayMemory() {
    const todayFile = path.join(MEMORY_DIR, `${getToday()}.md`);
    try {
        if (fs.existsSync(todayFile)) {
            try {
                return fs.readFileSync(todayFile, 'utf8');
            } catch (e) {
                console.error('Error reading file: ' + e.message);
                return null;
            }
        }
    } catch (e) {
        console.error('Error checking file: ' + e.message);
        return null;
    }
    return null;
}

// 從 memory 內容提取 key topics
function extractTopics(content) {
    if (!content) return [];

    const topics = [];

    // 提取標題 (# ## ###)
    const headerMatches = content.match(/^#+\s+(.+)$/gm);
    if (headerMatches) {
        headerMatches.forEach(match => {
            const topic = match.replace(/^#+\s+/, '').trim();
            if (topic && topic.length > 3 && !topics.includes(topic)) {
                topics.push(topic);
            }
        });
    }

    // 提取重點標記 (🔴 🟠 🟡 🟢 ⭐ 等)
    const markerMatches = content.match(/[🔴🟠🟡🟢⭐💡📝🎯⚠️]\s*([^\n]+)/g);
    if (markerMatches) {
        markerMatches.forEach(match => {
            const topic = match.replace(/^[🔴🟠🟡🟢⭐💡📝🎯⚠️]\s*/, '').trim();
            if (topic && topic.length > 3 && !topics.includes(topic)) {
                topics.push(topic);
            }
        });
    }

    // 提取列表項 (- * •)
    const listMatches = content.match(/^[-*•]\s+(.+)$/gm);
    if (listMatches && topics.length < 5) {
        listMatches.slice(0, 3).forEach(match => {
            const topic = match.replace(/^[-*•]\s+/, '').trim();
            if (topic && topic.length > 5 && topic.length < 100 && !topics.includes(topic)) {
                topics.push(topic);
            }
        });
    }

    return topics.slice(0, CONFIG.MAX_TOPICS); // 最多8個 topics
}

// 生成簡短摘要（50字內）
function generateSummary(topics) {
    if (!topics || topics.length === 0) {
        return '暫無新內容';
    }

    const summary = topics.slice(0, 3).join('、');
    if (summary.length > MAX_SUMMARY_LENGTH) {
        return summary.substring(0, MAX_SUMMARY_LENGTH - 3) + '...';
    }
    return summary;
}

// 生成今日重點
function generateTodayHighlights(context, topics) {
    const highlights = [...context.todayHighlights];

    // 加入新 topics（去重）
    topics.forEach(topic => {
        if (!highlights.includes(topic)) {
            highlights.push(topic);
        }
    });

    // 只保留最近 10 個
    return highlights.slice(-CONFIG.MAX_HIGHLIGHTS);
}

// 生成本週相關
function generateWeeklyTopics(context, todayHighlights) {
    const weekly = [...context.weeklyTopics];

    todayHighlights.forEach(topic => {
        if (!weekly.includes(topic)) {
            weekly.push(topic);
        }
    });

    // 只保留最近 20 個
    return weekly.slice(-CONFIG.MAX_WEEKLY);
}

// 格式化輸出
function formatRecallOutput(level, data) {
    const timestamp = new Date().toLocaleString('zh-HK', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    switch (level) {
        case 1:
            return `💓 [${timestamp}] 快速摘要: ${data.summary}`;
        case 3:
            return `💓💓💓 [${timestamp}] 今日重點 (${data.count}項): ${data.highlights.slice(0, 3).join('、')}`;
        case 6:
            return `💓💓💓💓💓💓 [${timestamp}] 本週相關 (${data.count}項): ${data.weekly.slice(0, 5).join('、')}`;
        default:
            return `💓 [${timestamp}] ${data.summary}`;
    }
}

// NEW 2026-02-20: Extract topics from sessions
function extractTopicsFromSessions() {
    // 使用 os.homedir() 替代 process.env.HOME，更可靠且處理邊緣情況
    const HOME_DIR = os.homedir();
    const SESSIONS_DIR = path.join(HOME_DIR, '.openclaw', 'agents', 'main', 'sessions');
    const TOPICS_FILE = path.join(MEMORY_DIR, 'conversation-topics.json');

    const topicsFound = new Set();

    try {
        if (!fs.existsSync(SESSIONS_DIR)) {
            return { topics: [], newTopics: [] };
        }
    } catch (e) {
        console.error('Error checking directory: ' + e.message);
        return { topics: [], newTopics: [] };
    }

    // Key topics to look for
    const keyPhrases = [
        'Rapaport', 'diamond', 'stock', 'memory', 'error', 'backup',
        'cron', 'heartbeat', 'session', 'Apple', 'Notes', 'training',
        'Qwen3', 'MiniMax', 'Kimi', 'model', 'token', 'automation',
        'Excel', 'workflow', 'automation', 'script', 'automation'
    ];

    // Get recent session files (last 10)
    let files = [];
    try {
        files = fs.readdirSync(SESSIONS_DIR)
            .filter(f => f.endsWith('.jsonl'))
            .sort()
            .reverse()
            .slice(0, 10);
    } catch (err) {
        console.error('⚠️ readdir failed: ' + err.message);
        return { topics: [], newTopics: [] };
    }

    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8');
        } catch (err) {
            console.error('⚠️ File read failed: ' + err.message);
            continue;
        }

        // Look for key phrases
        for (const phrase of keyPhrases) {
            if (content.toLowerCase().includes(phrase.toLowerCase())) {
                topicsFound.add(phrase);
            }
        }
    }

    // Load existing topics
    let existingTopics = [];
    try {
        if (fs.existsSync(TOPICS_FILE)) {
            const data = fs.readFileSync(TOPICS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            existingTopics = parsed.topics || [];
        }
    } catch (e) {
        log(`⚠️ Failed to load topics file: ${e.message}`);
        existingTopics = [];
    }

    // Find new topics
    const newTopics = Array.from(topicsFound).filter(t => !existingTopics.includes(t));

    // Save updated topics
    const updatedData = {
        topics: Array.from(topicsFound),
        lastUpdated: new Date().toISOString(),
        newTopicsCount: newTopics.length
    };

    try {
        const content = JSON.stringify(updatedData, null, 2);
        const tmpPath = TOPICS_FILE + '.tmp';
        try {
            fs.writeFileSync(tmpPath, content, 'utf8');
            fs.renameSync(tmpPath, TOPICS_FILE);
        } catch (e) {
            console.error('Error writing file: ' + e.message);
            return;
        }
    } catch (e) {
        console.error('Error writing file: ' + e.message);
        return;
    }

    return {
        topics: Array.from(topicsFound),
        newTopics: newTopics,
        existingTopics: existingTopics
    };
}

// NEW 2026-02-20: Cross-reference topics with past conversations
function checkTopicHistory(currentTopics) {
    const TOPICS_FILE = path.join(MEMORY_DIR, 'conversation-topics.json');

    try {
        if (!fs.existsSync(TOPICS_FILE)) {
            return { repeated: [], allTopics: currentTopics };
        }
    } catch (e) {
        console.error('Error checking file: ' + e.message);
        return { repeated: [], allTopics: currentTopics };
    }

    let data;
    try {
        data = fs.readFileSync(TOPICS_FILE, 'utf8');
    } catch (e) {
        console.error('Error reading file: ' + e.message);
        return { repeated: [], allTopics: currentTopics };
    }

    try {
        const parsed = JSON.parse(data);
        const allTopics = [...new Set([...currentTopics, ...(parsed.topics || [])])];

        const repeated = currentTopics.filter(t => (parsed.topics || []).includes(t));

        return {
            repeated: repeated,
            allTopics: allTopics
        };
    } catch (e) {
        return { repeated: [], allTopics: currentTopics };
    }
}

// 主要執行函數
function runHeartbeatRecall() {
    const context = loadContext();

    // 增加計數
    context.heartbeatCount++;

    // 讀取今日 memory
    const todayContent = readTodayMemory();
    const topics = extractTopics(todayContent);

    // NEW 2026-02-20: Extract topics from sessions
    const sessionTopicsData = extractTopicsFromSessions();
    const sessionTopics = sessionTopicsData.topics;

    // Cross-reference with past topics
    const topicHistory = checkTopicHistory(sessionTopics);

    // 生成快速摘要
    const summary = generateSummary(topics);

    // 更新當前 session
    context.currentSession = {
        topics: topics.slice(0, 5),
        sessionTopics: sessionTopics,
        repeatedTopics: topicHistory.repeated,
        lastSummary: summary,
        lastUpdate: new Date().toISOString()
    };

    // 如果發現重複topics，log佢
    if (topicHistory.repeated.length > 0) {
        log(`📝 發現重複topics: ${topicHistory.repeated.join(', ')}`);
    }

    // 決定回憶級別
    const level = context.heartbeatCount % 6 === 0 ? 6 :
                  context.heartbeatCount % 3 === 0 ? 3 : 1;

    let output = '';

    // 執行對應級別的回憶
    if (level >= 1) {
        // 級別 1: 快速摘要（每次都執行）
        output = formatRecallOutput(1, { summary });
    }

    if (level >= 3) {
        // 級別 3: 今日重點
        context.todayHighlights = generateTodayHighlights(context, topics);
        const todayOutput = formatRecallOutput(3, {
            highlights: context.todayHighlights,
            count: context.todayHighlights.length
        });
        output = todayOutput;
    }

    if (level >= 6) {
        // 級別 6: 本週相關
        context.weeklyTopics = generateWeeklyTopics(context, context.todayHighlights);
        const weeklyOutput = formatRecallOutput(6, {
            weekly: context.weeklyTopics,
            count: context.weeklyTopics.length
        });
        output = weeklyOutput;

        // 每週重置今日重點（如果是星期日）
        const now = new Date();
        if (now.getDay() === 0) {
            context.todayHighlights = [];
        }
    }

    // 記錄歷史
    context.recallHistory.push({
        timestamp: new Date().toISOString(),
        level,
        summary,
        topicsCount: topics.length
    });

    // 只保留最近 50 條歷史
    if (context.recallHistory.length > 50) {
        context.recallHistory = context.recallHistory.slice(-50);
    }

    // 儲存狀態
    saveContext(context);

    // 輸出結果
    log(output);

    // 返回結構化數據（供其他腳本使用）
    return {
        level,
        output,
        summary,
        topics,
        heartbeatCount: context.heartbeatCount,
        todayHighlights: context.todayHighlights,
        weeklyTopics: context.weeklyTopics
    };
}

// 顯示狀態
function showStatus() {
    const context = loadContext();
    const nextLevel = context.heartbeatCount % 6 === 0 ? 6 :
                      context.heartbeatCount % 3 === 0 ? 3 : 1;

    log('📊 Heartbeat 回憶系統狀態');
    log('========================');
    log(`🔄 Heartbeat 次數: ${context.heartbeatCount}`);
    log(`📅 初始化時間: ${new Date(context.initializedAt).toLocaleString('zh-HK')}`);
    log(`⏭️  下次回憶級別: ${nextLevel === 6 ? '本週相關 (6)' : nextLevel === 3 ? '今日重點 (3)' : '快速摘要 (1)'}`);
    log('');
    log('💭 當前 Session:');
    log(`   最後更新: ${context.currentSession.lastUpdate ? new Date(context.currentSession.lastUpdate).toLocaleString('zh-HK') : 'N/A'}`);
    log(`   摘要: ${context.currentSession.lastSummary || 'N/A'}`);
    log('');
    log(`📌 今日重點 (${context.todayHighlights.length}項):`);
    context.todayHighlights.slice(-5).forEach((h, i) => {
        log(`   ${i + 1}. ${h}`);
    });
    log('');
    log(`📚 本週相關 (${context.weeklyTopics.length}項):`);
    context.weeklyTopics.slice(-5).forEach((t, i) => {
        log(`   ${i + 1}. ${t}`);
    });
}

// 重置系統
function resetSystem() {
    const newContext = {
        initializedAt: new Date().toISOString(),
        heartbeatCount: 0,
        currentSession: {
            topics: [],
            lastSummary: null,
            lastUpdate: null
        },
        todayHighlights: [],
        weeklyTopics: [],
        recallHistory: []
    };
    saveContext(newContext);
    log('✅ Heartbeat 回憶系統已重置');
}

// 命令行處理
const args = process.argv.slice(2);

if (args.includes('--status')) {
    showStatus();
} else if (args.includes('--reset')) {
    resetSystem();
} else {
    // 默認執行 heartbeat 回憶
    const result = runHeartbeatRecall();

    // 如果要求 JSON 輸出
    if (args.includes('--json')) {
        log('\n---JSON_OUTPUT---');
        log(JSON.stringify(result, null, 2));
    }
}
