#!/usr/bin/env node
/**
 * Health API Server - 為 dashboard.html 提供健康數據
 * 
 * 使用方法:
 *   node health_api.js           # 啟動 server (port 18790)
 *   node health_api.js --port 3000  # 自定義 port
 * 
 * API Endpoints:
 *   GET /health           - 返回健康數據 JSON
 *   GET /health/simple    - 返回簡化版數據
 *   GET /                 - 返回 API 狀態
 */

const http = require('http');
const { execSync } = require('child_process');
const path = require('path');

const PORT = process.argv.includes('--port') 
  ? parseInt(process.argv[process.argv.indexOf('--port') + 1]) 
  : 18790;

const HOST = '127.0.0.1';

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// 獲取健康數據
function getHealthData() {
  try {
    const scriptPath = path.join(__dirname, 'health_monitor.js');
    const output = execSync(`node "${scriptPath}" --json`, { 
      encoding: 'utf8',
      timeout: 10000 
    });
    return JSON.parse(output);
  } catch (error) {
    return {
      error: true,
      message: error.message,
      time: new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      timestamp: Date.now()
    };
  }
}

// 獲取簡化版數據
function getSimpleHealthData() {
  const data = getHealthData();
  if (data.error) return data;
  
  return {
    time: data.time,
    status: getOverallStatus(data),
    system: {
      status: data.system?.status || 'unknown',
      cpu: data.system?.cpuIdle + '% idle',
      memory: data.system?.memPercent + '%',
      load: data.system?.load
    },
    disk: {
      status: data.disk?.status || 'unknown',
      used: data.disk?.value + '%'
    },
    gateway: data.gateway?.status || 'unknown',
    sessions: data.sessions?.count || 0,
    errors: data.errors?.count || 0
  };
}

// 計算整體狀態
function getOverallStatus(data) {
  const statuses = [
    data.system?.status,
    data.disk?.status,
    data.errors?.status,
    data.cron?.status,
    data.gateway?.status,
    data.channels?.status
  ];
  
  if (statuses.includes('CRITICAL') || statuses.includes('error')) return 'CRITICAL';
  if (statuses.includes('WARNING')) return 'WARNING';
  return 'OK';
}

// 創建 HTTP server
const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  
  switch (url.pathname) {
    case '/health':
      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify(getHealthData(), null, 2));
      break;
      
    case '/health/simple':
      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify(getSimpleHealthData(), null, 2));
      break;
      
    case '/':
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'Health API Server',
        version: '1.0.0',
        endpoints: {
          '/health': 'Full health data',
          '/health/simple': 'Simplified health data'
        },
        status: 'running',
        uptime: process.uptime()
      }, null, 2));
      break;
      
    default:
      res.writeHead(404, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// 啟動 server
server.listen(PORT, HOST, () => {
  console.log(`🩺 Health API Server running at http://${HOST}:${PORT}/`);
  console.log(`   Endpoints:`);
  console.log(`     - GET /health        - Full health data`);
  console.log(`     - GET /health/simple - Simplified data`);
  console.log(`   Press Ctrl+C to stop`);
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down Health API Server...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
