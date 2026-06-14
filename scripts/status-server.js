const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * System Status Monitor
 * 檢查 OpenClaw、WhatsApp、Kimi、Qwen3 實時狀態
 */

// HR-072: Magic numbers moved to CONFIG
const CONFIG = {
  DEFAULT_PORT: 3456,
  CHECK_INTERVAL_MS: 30000,  // 30 seconds
  LOCALHOST: '127.0.0.1',    // Bind address for security
  HTTP_TIMEOUT: 5000,       // 5 seconds timeout for HTTP requests
};

const http = require('http');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { getHKTDateTime } = require('./lib/time');

// 配置
const PORT = process.env.STATUS_PORT || CONFIG.DEFAULT_PORT;
const CHECK_INTERVAL = CONFIG.CHECK_INTERVAL_MS; // 30秒檢查一次

// 狀態緩存
let systemStatus = {
    openclaw: { status: 'unknown', lastCheck: null, latency: null, message: '' },
    whatsapp: { status: 'unknown', lastCheck: null, latency: null, message: '' },
    kimi: { status: 'unknown', lastCheck: null, latency: null, message: '' },
    qwen3: { status: 'unknown', lastCheck: null, latency: null, message: '' }
};

// CORS 頭
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// 檢查 OpenClaw 狀態
async function checkOpenClaw() {
    const start = Date.now();
    try {
        // 檢查 OpenClaw 進程
        const { stdout } = await execPromise('pgrep -f "openclaw" | head -1');
        if (stdout.trim()) {
            return {
                status: 'online',
                latency: Date.now() - start,
                message: 'Running'
            };
        }
        return { status: 'offline', latency: null, message: 'Process not found' };
    } catch (error) {
        return { status: 'offline', latency: null, message: 'Process not found' };
    }
}

// 檢查 WhatsApp 狀態
async function checkWhatsApp() {
    const start = Date.now();
    try {
        // 檢查 WhatsApp Gateway（假設用 whatsapp-web.js 或類似）
        // 這裡檢查是否有相關進程或端口
        const { stdout } = await execPromise('lsof -i :3000 | grep LISTEN || echo "not found"');
        if (stdout.includes('LISTEN')) {
            return {
                status: 'online',
                latency: Date.now() - start,
                message: 'Gateway connected'
            };
        }
        // 備用：檢查進程
        const { stdout: ps } = await execPromise('pgrep -f "whatsapp" | head -1 || echo ""');
        if (ps.trim()) {
            return {
                status: 'online',
                latency: Date.now() - start,
                message: 'Process running'
            };
        }
        return { status: 'offline', latency: null, message: 'Gateway disconnected' };
    } catch (error) {
        return { status: 'offline', latency: null, message: 'Check failed' };
    }
}

// 檢查 Kimi API 狀態
async function checkKimi() {
    const start = Date.now();
    try {
        // Kimi API 健康檢查（Moonshot AI）
        const response = await fetch('https://api.moonshot.cn/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.KIMI_API_KEY || ''}`
            }
        });

        if (response.ok) {
            return {
                status: 'online',
                latency: Date.now() - start,
                message: 'API responsive'
            };
        }
        return { status: 'degraded', latency: Date.now() - start, message: `HTTP ${response.status}` };
    } catch (error) {
        // 如果沒有 API key，檢查網絡連接
        try {
            await fetch('https://api.moonshot.cn', { method: 'HEAD', timeout: 5000 });
            return { status: 'online', latency: Date.now() - start, message: 'Reachable' };
        } catch {
            return { status: 'offline', latency: null, message: 'Network unreachable' };
        }
    }
}

// 檢查 Qwen3 (Ollama) 狀態
async function checkQwen3() {
    const start = Date.now();
    try {
        // 檢查 Ollama 服務
        const response = await fetch('http://localhost:11434/api/tags', {
            method: 'GET',
            timeout: 3000
        });

        if (response.ok) {
            const data = await response.json();
            const hasQwen3 = data.models?.some(m => m.name.includes('qwen3'));
            return {
                status: 'online',
                latency: Date.now() - start,
                message: hasQwen3 ? 'Qwen3 loaded' : 'Ollama running'
            };
        }
        return { status: 'offline', latency: null, message: 'Service not responding' };
    } catch (error) {
        // 檢查進程是否存在
        try {
            const { stdout } = await execPromise('pgrep -f "ollama" | head -1 || echo ""');
            if (stdout.trim()) {
                return { status: 'degraded', latency: null, message: 'Starting up...' };
            }
        } catch { /* ignore pgrep error */ }
        return { status: 'offline', latency: null, message: 'Ollama not running' };
    }
}

// 執行所有檢查
async function runAllChecks() {
    const timestamp = getHKTDateTime();

    const [openclaw, whatsapp, kimi, qwen3] = await Promise.allSettled([
        checkOpenClaw(),
        checkWhatsApp(),
        checkKimi(),
        checkQwen3()
    ]);

    systemStatus = {
        openclaw: { ...openclaw.value, lastCheck: timestamp },
        whatsapp: { ...whatsapp.value, lastCheck: timestamp },
        kimi: { ...kimi.value, lastCheck: timestamp },
        qwen3: { ...qwen3.value, lastCheck: timestamp }
    };

    log(`[${new Date().toLocaleTimeString()}] Status updated:`);
    Object.entries(systemStatus).forEach(([name, data]) => {
        log(`  ${name}: ${data.status}${data.latency ? ` (${data.latency}ms)` : ''}`);
    });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
    // CORS 預檢
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    // 狀態 API
    if (req.url === '/api/status' && req.method === 'GET') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({
            timestamp: getHKTDateTime(),
            services: systemStatus
        }));
        return;
    }

    // 健康檢查
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ status: 'ok', timestamp: getHKTDateTime() }));
        return;
    }

    // 404
    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ error: 'Not found' }));
});

// 啟動 - 只綁定 localhost 以提高安全性
server.listen(PORT, CONFIG.LOCALHOST, () => {
    log(`🚀 Status Monitor running on http://${CONFIG.LOCALHOST}:${PORT}`);
    log(`   - Local: http://localhost:${PORT}/api/status`);
    log(`   - Health: http://localhost:${PORT}/health`);

    // 立即檢查一次
    runAllChecks();

    // 定期檢查
    setInterval(runAllChecks, CHECK_INTERVAL);
});

// 優雅關閉
process.on('SIGTERM', () => {
    log('\n👋 Shutting down status monitor...');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    log('\n👋 Shutting down status monitor...');
    server.close(() => {
        process.exit(0);
    });
});
