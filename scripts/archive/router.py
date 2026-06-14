#!/usr/bin/env python3
"""Router Pattern v5"""
import json

# 跳過 cron job 消息
SKIP_PATTERNS = [
    "Memory Logger",
    "Run: node",
    "Reply NO_REPLY",
    "Daily Maintenance",
    "Adaptive Timeout",
    "Smoke Test",
    "node " + __import__('os').path.expanduser("~/.openclaw/workspace/scripts/")
]

def should_skip(message):
    if not message:
        return False
    for pattern in SKIP_PATTERNS:
        if pattern.lower() in message.lower():
            return True
    return False

CONFIG = {
    "keywords": {
        "coder": ["代碼","編程","script","code","寫","寫","python","javascript","node","java","function","class","api","開發","開發","debug","bug"],
        "data": ["數據","數據","分析","excel","csv","統計","統計","report","報告","报告","圖表","圖表"],
        "research": ["研究","調查","調查","搜尋","搜集","趨勢","趋势"],
        "writer": ["寫","寫","文章","文案","內容","內容","創作","創作"],
        "web": ["爬蟲","爬虫","scraper","抓取","crawl","網站","網站"],
        "image": ["去除背景", "去背", "摳圖", "圖片處理", "照片編輯", "p圖", "改圖", "resize", "crop", "filter"],
        "file": [".js", ".py", ".json", ".csv", ".ts", ".html", ".css", ".md", ".txt"],
        "review": ["睇下", "看看", "檢查", "review", "分析下", "幫手睇", "幫我看"],
        "complex": ["優化", "改進", "重構", "設計", "架構", "規劃", "策略"],
    },
    "simple": ["你好","hi","hello","謝謝","谢谢","thanks","多謝","多谢","再見","再見","bye","ok","明白"]
}

# 文件擴展名檢測
FILE_EXTENSIONS = [".js", ".py", ".json", ".csv", ".ts", ".html", ".css", ".md", ".txt"]

def has_file_extension(msg):
    return any(ext in msg.lower() for ext in FILE_EXTENSIONS)

def route(msg):
    # 檢查是否為 cron job 消息，如果是則直接返回 self
    if should_skip(msg):
        return {"decision": "self", "complexity": "low", "reason": "cron job", "suggestedModel": "minimax", "runtime": None, "agentLabel": None}

    if not msg or not msg.strip():
        return {"decision": "self", "complexity": "low", "suggestedModel": "minimax", "runtime": None, "agentLabel": None}

    c = len(msg.strip())
    t = msg.lower()

    # 檢測文件擴展名
    if has_file_extension(msg):
        return {"decision": "spawn", "complexity": "medium", "reason": "文件處理", "suggestedModel": "kimi", "runtime": "subagent", "agentLabel": "file", "taskType": "file"}

    task_type = "general"
    has_complex = False
    for tt, kws in CONFIG["keywords"].items():
        if any(k in t for k in kws):
            task_type = tt
            has_complex = True
            break

    if has_complex:
        return {"decision": "spawn", "complexity": "medium", "reason": f"{task_type}任務", "suggestedModel": "kimi", "runtime": "subagent", "agentLabel": task_type, "taskType": task_type}

    if c < 10 and any(k in t for k in CONFIG["simple"]):
        return {"decision": "self", "complexity": "low", "reason": "問候", "suggestedModel": "minimax", "runtime": None, "agentLabel": None}

    if c > 20:  # 從 30 改為 20
        return {"decision": "spawn", "complexity": "high", "reason": "長任務", "suggestedModel": "kimi", "runtime": "subagent", "agentLabel": "general"}

    return {"decision": "self", "complexity": "low", "reason": "短問題", "suggestedModel": "minimax", "runtime": None, "agentLabel": None}

if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    if "--test" in args:
        for m in ["你好", "spawn", "幫我寫代碼", "幫我寫Node.js script", "分析銷售數據", "123"]:
            r = route(m)
            label = r.get("agentLabel") or "-"
            print(f"{m:<25} -> {r['decision']:<6} {label}")
    else:
        # FIX: Read message from stdin to prevent command injection
        # Usage: echo "user message" | python3 router.py
        #   or: python3 router.py < <(echo "user message")
        msg = sys.stdin.read().strip() if not sys.stdin.isatty() else ""
        if not msg:
            import shlex
            msg = " ".join(shlex.quote(a) for a in args)
        print(json.dumps(route(msg), ensure_ascii=False, indent=2))
