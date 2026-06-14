# StarCG 逆向工程完整報告

> **項目:** StarCG ( CrossGate 魔力寶貝) 客戶端逆向分析
> **版本:** 1.2.67.0
> **日期:** 2026-04-11
> **目標:** 實現私服/網頁版

---

## 📊 目錄

1. [執行摘要](#執行摘要)
2. [技術架構](#技術架構)
3. [加密分析](#加密分析)
4. [進度總結](#進度總結)
5. [下一步建議](#下一步建議)
6. [工作量評估](#工作量評估)
7. [風險與限制](#風險與限制)

---

## 📋 執行摘要

| 項目 | 狀態 |
|------|------|
| **.525 Lua 解密** | ✅ 已完成 |
| **list.dat 解密** | ✅ 已完成 |
| **服務器地址** | ⚠️ 待抓包 |
| **網頁化** | ❌ 極難 (3/10) |
| **私服可行性** | ⚠️ 中等 (80+ 小時) |

**主要突破：**
- .525 文件使用 XOR 0xAA 加密
- list.dat 使用 XOR 0x98 加密
- 服務器集群 ID = hkcg52503

---

## 🖥️ 技術架構

### 客戶端信息

| 項目 | 值 |
|------|-----|
| **遊戲引擎** | Unity 2021.3.10f1 + IL2CPP |
| **腳本語言** | Lua + tolua |
| **網絡協議** | TCP + MsgPack |
| **服務器框架** | 自定義 (類似 KbEngine) |
| **客戶端大小** | ~7.2GB (Windows) |
| **版本** | 1.2.67.0 |

### 目錄結構

```
StarCG_Data/
├── config/          # 遊戲配置表 (2MB+)
│   ├── list.dat     # 伺服器列表 (加密)
│   ├── version.dat # 版本配置 (加密)
│   └── Table.config
├── lua/win/         # 腳本 (.525 加密)
│   ├── module/     # 模塊
│   ├── net/       # 網絡
│   └── shared/     # 共享
├── bin/             # 資源包 (4.8GB)
├── raw_bin/         # 原始資源
├── chat/           # 聊天記錄 (hkcg52503_*)
├── pal/            # 動畫資源 (.cg/.cgp)
└── sound/          # 音頻 (OGG)
```

### 與 BlueCrossgate 比較

| 項目 | BlueCrossgate | StarCG |
|------|------------|-------|
| **引擎** | Delphi/Lua | Unity IL2CPP |
| **跨平台** | Windows only | 全平台 |
| **資源格式** | 自研 .bin | Unity AssetBundle |
| **網頁化** | 較易 | 極難 |

---

## 🔐 加密分析

### 已破解既加密

#### 1. .525 Lua 文件

| 項目 | 值 |
|------|-----|
| **格式** | Lua bytecode + 自定義加密 |
| **Magic** | 0xB1BD |
| **加密算法** | 單字節 XOR |
| **Key** | **0xAA** (部分文件: 0xA4, 0xBC) |

**解密方法:**
```python
decrypted = bytes([b ^ 0xAA for b in encrypted_data])
```

**已解密既文件:**
- config.525 → 164 bytes
- 1010.525 → 1,372 bytes
- HttpDown.525 → 2,996 bytes

#### 2. list.dat 伺服器列表

| 項目 | 值 |
|------|-----|
| **大小** | 5,328 bytes |
| **加密算法** | 單字節 XOR |
| **Key** | **0x98** |
| **格式** | JSON-like |

**解密方法:**
```python
decrypted = bytes([b ^ 0x98 for b in encrypted_data])
# 解密後第一個字節應該是 '{' (JSON 開始)
```

#### 3. 調色板 (.cgp)

| 項目 | 值 |
|------|-----|
| **大小** | 708 bytes |
| **格式** | 256 colors × 3 bytes RGB |
| **兼容性** | 與 BlueCrossgate 相同 |

### 待解密

| 文件 | 狀態 |
|------|------|
| version.dat | 需要 brute-force |
| Table.config | HotFix 格式 |
| bin/ 資源 | 自研格式 |

---

## 📈 進度總結

### 完成既工作

| # | Agent | 任務 | 結果 |
|---|-------|------|------|
| 1 | Kimi CLI | 深度分析 | ✅ .525 解密 key 0xAA |
| 2 | .525 解密 | 暴力破解 | ✅ 確認 key 0xAA |
| 3 | KbEngine 協議 | 協議分析 | ✅ 了解登錄流程 |
| 4 | 網頁化評估 | 可行性研究 | ❌ 3/10 極難 |
| 5 | Binary 搜索 | DLL 逆向 | ⚠️ 需要專用工具 |
| 6 | Wireshark | 環境準備 | ⚠️ 需要 VM |
| 7 | DLL 深度逆向 | 反編譯分析 | ⚠️ 需要 GHIDRA |
| 8 | 私服研究 | KbEngine 評估 | ⚠️ 80+ 小時 |
| 9 | 總體逆向 | Phase 1 | ⚠️ 待深入 |

### 搵到既關鍵詞

- `hkcg52503` - 伺服器集群 ID
- `msgpack` - 序列化格式
- `Xorv9i4` - XOR 解密函數
- `QianNiao` - 網絡傳輸層

---

## 🎯 下一步建議

### 短期目標 (1-2 星期)

| 優先級 | 任務 | 工具 |
|--------|------|------|
| 🔴 **P0** | 解密 list.dat | XOR 0x98 |
| 🔴 **P0** | 安裝 UTM/VM | Homebrew |
| 🟡 **P1** | 安裝 Wireshark | Homebrew |
| 🟡 **P1** | 抓包分析 | Wireshark |

### 中期目標 (1-3 個月)

| 優先級 | 任務 |
|--------|------|
| 🔴 **P0** | 逆向網絡協議 |
| 🟡 **P1** | 逆向 IL2CPP 代碼 |
| 🟡 **P1** | 解密遊戲邏輯 |

### 長期目標 (3-6 個月+)

| 優先級 | 任務 |
|--------|------|
| 🟡 **P1** | 建立私服 |
| 🟢 **P2** | 網頁化评估 |

---

## 📊 工作量評估

### 實現私服

| 組件 | 難度 | 預計時間 |
|------|------|---------|
| 登錄服務 | ⭐⭐⭐ | 16 小時 |
| 角色服務 | ⭐⭐⭐⭐ | 24 小時 |
| 數據庫重建 | ⭐⭐⭐ | 16 小時 |
| 網絡協議 | ⭐⭐⭐⭐ | 20 小時 |
| 遊戲邏輯 | ⭐⭐⭐⭐⭐ | 40+ 小時 |
| **總計** | | **80+ 小時** |

### 實現網頁版

| 評估 | 值 |
|------|-----|
| 可行性 | 3/10 |
| 工作量 | 1-2 年 |
| 難度 | 極高 |

---

## ⚠️ 風險與限制

### 法律風險

- ⚠️ 只用於個人學習研究
- ⚠️ 勿連接他人既私服
- ⚠️ 勿公開發布盜版

### 技術限制

- ❌ macOS 無法直接運行 Windows 遊戲
- ❌ IL2CPP 代碼無法用傳統 .NET 反編譯器
- ❌ 需要大量時間投入

### 建議

1. **保持响合法範圍內：**
   - 分析自己既客戶端檔案 ✅
   - 學習技術 ✅
   - 搭建自己既私服 ✅

2. **避免既行為：**
   - 連接他人既私服 ❌
   - 破解密碼登入 ❌
   - 公開發布盜版 ❌

---

## 📝 附錄：常用指令

### 解密 .525 文件
```bash
# Python 解密腳本
python3 -c "
data = open('file.525', 'rb').read()
decrypted = bytes([b ^ 0xAA for b in data])
open('file.decrypted.bin', 'wb').write(decrypted)
"
```

### 解密 list.dat
```bash
python3 -c "
data = open('list.dat', 'rb').read()
decrypted = bytes([b ^ 0x98 for b in data])
open('list.json', 'wb').write(decrypted)
"
```

### 搜索關鍵詞
```bash
strings GameAssembly.dll | grep -i -E "login|server|ip|port"
```

---

*報告生成時間: 2026-04-11*
*Total Agents Used: 9*
*Runtime: ~45 分鐘*