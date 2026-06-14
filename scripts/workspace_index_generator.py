#!/usr/bin/env python3
"""
Workspace Index Generator
自動掃描 ~/.openclaw/workspace 入面所有 .md 文件，生成索引報告
"""

import os
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict

WORKSPACE_DIR = Path.home() / ".openclaw" / "workspace"
OUTPUT_FILE = WORKSPACE_DIR / "workspace_index.md"


def get_category(filename: str) -> str:
    """根據文件名判斷分類"""
    name_lower = filename.lower()

    if name_lower in ["soul.md", "identity.md", "agents.md", "user.md"]:
        return "🏠 身份與角色"
    elif name_lower in ["tools.md", "spawn_rules.md"]:
        return "🔧 工具與規則"
    elif name_lower in ["memory.md", "errors.md"]:
        return "📚 記憶與錯誤"
    elif name_lower.startswith("memory/"):
        return "🧠 記憶存檔"
    elif name_lower.startswith(".issues/"):
        return "📋 任務追蹤"
    elif "script" in name_lower or name_lower.endswith(".js"):
        return "💻 腳本"
    elif name_lower.endswith(".md"):
        return "📝 一般文件"
    else:
        return "📄 其他"


def extract_h1_heading(content: str) -> str:
    """提取第一個 H1 標題"""
    try:
        # 匹配 # 開頭的標題（行首）
        for line in content.split('\n'):
            line = line.strip()
            if line.startswith('# '):
                # 去除 # 並返回標題文字
                return line[2:].strip()
    except Exception:
        pass
    return "（無標題）"


def format_filesize(size_bytes: int) -> str:
    """格式化文件大小"""
    for unit in ['B', 'KB', 'MB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} GB"


def format_datetime(timestamp: float) -> str:
    """格式化時間為可讀格式"""
    dt = datetime.fromtimestamp(timestamp)
    return dt.strftime("%Y-%m-%d %H:%M")


def scan_workspace() -> dict:
    """掃描 workspace 中的所有 .md 文件"""
    files_data = defaultdict(list)

    if not WORKSPACE_DIR.exists():
        print(f"❌ 目錄不存在: {WORKSPACE_DIR}")
        return files_data

    # 遞歸掃描所有 .md 文件
    for md_file in WORKSPACE_DIR.rglob("*.md"):
        try:
            # 獲取文件信息
            stat = md_file.stat()
            filename = md_file.name
            size = stat.st_size
            mtime = stat.st_mtime

            # 讀取內容提取 H1
            try:
                with open(md_file, 'r', encoding='utf-8') as f:
                    content = f.read()
            except UnicodeDecodeError:
                try:
                    with open(md_file, 'r', encoding='latin-1') as f:
                        content = f.read()
                except Exception:
                    content = ""

            h1_heading = extract_h1_heading(content)
            category = get_category(str(md_file.relative_to(WORKSPACE_DIR)))

            files_data[category].append({
                "filename": filename,
                "path": str(md_file.relative_to(WORKSPACE_DIR)),
                "h1_heading": h1_heading,
                "mtime": format_datetime(mtime),
                "size": format_filesize(size),
                "size_bytes": size
            })

        except Exception as e:
            print(f"⚠️ 處理失敗 {md_file}: {e}")
            continue

    return files_data


def generate_markdown(files_data: dict) -> str:
    """生成 Markdown 格式的報告"""
    lines = []

    # 標題
    lines.append("# Workspace Index Report")
    lines.append("")
    lines.append(f"*生成時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")
    lines.append("")
    lines.append(f"**Workspace 目錄:** `{WORKSPACE_DIR}`")
    lines.append("")
    lines.append("---")
    lines.append("")

    # 按分類輸出
    category_order = [
        "🏠 身份與角色",
        "🔧 工具與規則",
        "📚 記憶與錯誤",
        "🧠 記憶存檔",
        "📋 任務追蹤",
        "💻 腳本",
        "📝 一般文件",
        "📄 其他"
    ]

    total_files = 0

    for category in category_order:
        if category not in files_data:
            continue

        files = files_data[category]
        if not files:
            continue

        # 按路徑排序
        files.sort(key=lambda x: x["path"])

        lines.append(f"## {category}")
        lines.append("")
        lines.append(f"| 文件名 | H1 標題 | 修改時間 | 大小 |")
        lines.append(f"|--------|---------|----------|------|")

        for f in files:
            filename = f["filename"]
            h1 = f["h1_heading"]
            mtime = f["mtime"]
            size = f["size"]

            # 截斷過長的標題
            if len(h1) > 40:
                h1 = h1[:37] + "..."

            lines.append(f"| `{filename}` | {h1} | {mtime} | {size} |")

        lines.append("")
        total_files += len(files)

    # 統計
    lines.append("---")
    lines.append("")
    lines.append(f"**總計: {total_files} 個 .md 文件**")
    lines.append("")

    return "\n".join(lines)


def main():
    print(f"🔍 掃描目錄: {WORKSPACE_DIR}")
    print("")

    files_data = scan_workspace()

    if not files_data:
        print("❌ 冇發現任何 .md 文件")
        return

    # 統計
    total = sum(len(files) for files in files_data.values())
    print(f"✅ 發現 {total} 個 .md 文件")
    print("")

    # 生成報告
    markdown = generate_markdown(files_data)

    # 寫入文件
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(markdown)

    print(f"✅ 已生成索引報告: {OUTPUT_FILE}")
    print(f"   📄 {total} 個文件，{len(files_data)} 個分類")


if __name__ == "__main__":
    main()
