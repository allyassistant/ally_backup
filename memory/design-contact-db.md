# 人際資源庫 - 結構設計

## 目標
建立一個結構化既「人際資源庫」，方便存儲同快速檢索業務相關既聯絡人資訊。

---

## JSON 結構設計

### 頂層結構
```json
{
  "version": "1.0",
  "last_updated": "2026-02-16T12:00:00Z",
  "contacts": [
    // Contact objects here
  ],
  "categories": {
    // Category metadata
  }
}
```

### Contact 對象
```json
{
  "id": "cnt_001",
  "name": "張志明",
  "name_cn": "張志明",
  "name_en": "Cheung Chi Ming",
  
  "type": "client",
  "subtype": "retail",
  
  "relationship_level": "A",
  
  "contacts": {
    "phone_primary": "+852XXXXXX",
    "phone_secondary": null,
    "whatsapp": "+852XXXXXX",
    "email": "cmm@example.com",
    "wechat": "cmm_hk",
    "line": null
  },
  
  "company": {
    "name_cn": "志明珠寶有限公司",
    "name_en": "Chi Ming Jewellery Ltd",
    "position": "董事長"
  },
  
  "tags": ["VIP", "批發", "廣東話"],
  
  "first_contact": "2025-06-15",
  "last_contact": "2026-02-10",
  "contact_frequency": "monthly",
  
  "notes": "主要做結婚戒指，注重品質多於價格",
  
  "preferences": {
    "language": " Cantonese",
    "preferred_shape": ["RBC", "CU"],
    "budget_range": "50000-100000",
    "payment_terms": "Net 30"
  },
  
  "deals": [
    {
      "date": "2025-12-20",
      "type": "purchase",
      "items": ["1.5ct RBC E VS1"],
      "value": 65000,
      "status": "completed"
    }
  ],
  
  "reminders": [
    {
      "id": "rem_c1",
      "type": "follow_up",
      "due": "2026-03-01",
      "note": "春節後 follow up"
    }
  ],
  
  "created_at": "2025-06-15T10:00:00Z",
  "updated_at": "2026-02-10T15:30:00Z"
}
```

---

## 欄位說明

### 基本資訊
| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 唯一識別碼，格式 `cnt_XXX` |
| name | string | ✅ | 主要名稱（廣東話/中文） |
| name_cn | string | - | 中文全名 |
| name_en | string | - | 英文名 |

### 分類
| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| type | enum | ✅ | 聯絡人類型 |
| subtype | enum | - | 子類型 |
| relationship_level | enum | ✅ | 關係等級 |

#### type (聯絡人類型)
```javascript
const CONTACT_TYPES = {
  'client': '客戶',
  'supplier': '供應商',
  'agent': '中介/代理',
  'manufacturer': '工廠/製造商',
  'logistics': '物流',
  'professional': '專業人士（律師、會計師等）',
  'industry': '業界人士',
  'personal': '個人/朋友',
  'other': '其他'
};
```

#### subtype (子類型)
```javascript
// client
const CLIENT_SUBTYPES = {
  'retail': '零售客戶',
  'wholesale': '批發客戶',
  'jeweller': '珠寶商',
  'online': '網店客戶'
};

// supplier
const SUPPLIER_SUBTYPES = {
  'diamond': '鑽石供應商',
  'gold': '金料供應商',
  'finding': '配件供應商',
  'packaging': '包裝供應商'
};

// agent
const AGENT_SUBTYPES = {
  'diamond_agent': '鑽石中介',
  'buyer_agent': '採購代理',
  'sales_agent': '銷售代理'
};
```

#### relationship_level (關係等級)
```javascript
const RELATIONSHIP_LEVELS = {
  'A': '重要客戶/合作夥伴',
  'B': '穩定客戶',
  'C': '普通客戶',
  'D': '潛在客戶',
  'N': '非活躍'
};
```

### 聯絡方式
```json
"contacts": {
  "phone_primary": "+852XXXXXX",    // 主要電話
  "phone_secondary": "+852XXXXXX",   // 備用電話
  "whatsapp": "+852XXXXXX",          // WhatsApp
  "email": "example@email.com",        // 電郵
  "wechat": "wechat_id",               // WeChat ID
  "line": "line_id",                   // LINE ID
  "telegram": "telegram_id"            // Telegram
}
```

### 公司資訊（ Business Contacts）
```json
"company": {
  "name_cn": "公司中文名",
  "name_en": "Company English Name",
  "position": "職位/頭銜"
}
```

### 標籤系統
```json
"tags": ["VIP", "批發", "廣東話", "深圳", "高價值"]
```
可自定義標籤，方便檢索同分類。

### 接觸記錄
| 欄位 | 類型 | 說明 |
|------|------|------|
| first_contact | date | 第一次接觸日期 |
| last_contact | date | 最近一次接觸日期 |
| contact_frequency | enum | 接觸頻率 |

```javascript
const CONTACT_FREQUENCY = {
  'weekly': '每週',
  'biweekly': '每兩週',
  'monthly': '每月',
  'quarterly': '每季',
  'yearly': '每年',
  'occasional': '偶爾',
  'inactive': '不活躍'
};
```

### 備註
```json
"notes": "詳細備註，可包含重要資訊..."
```

### 偏好設置
```json
"preferences": {
  "language": "Cantonese",           // 語言偏好
  "preferred_shape": ["RBC", "CU"],  // 偏好形狀
  "budget_range": "50000-100000",   // 預算範圍
  "payment_terms": "Net 30",        // 付款條款
  "communication_style": "formal"   // 溝通風格
}
```

### 交易記錄
```json
"deals": [
  {
    "date": "2025-12-20",
    "type": "purchase",              // purchase / sale / inquiry
    "items": ["1.5ct RBC E VS1"],
    "value": 65000,
    "status": "completed"           // completed / pending / cancelled
  }
]
```

### 提醒
```json
"reminders": [
  {
    "id": "rem_c1",
    "type": "follow_up",             // follow_up / birthday / payment
    "due": "2026-03-01",
    "note": "春節後 follow up"
  }
]
```

---

## 數據檔案位置

### 主檔案
```
/Users/ally/.openclaw/workspace/memory/contact-database.json
```

### 備份
```
/Users/ally/.openclaw/workspace/memory/backups/contact-db-backup-YYYY-MM-DD.json
```

### 索引
```
/Users/ally/.openclaw/workspace/memory/contact-index.json
```

---

## 快速檢索

### 索引結構
```json
{
  "by_name": {
    "張志明": "cnt_001",
    "Josh": "cnt_002"
  },
  "by_type": {
    "client": ["cnt_001", "cnt_003"],
    "supplier": ["cnt_004"]
  },
  "by_relationship": {
    "A": ["cnt_001", "cnt_002"],
    "B": ["cnt_003"]
  },
  "by_tag": {
    "VIP": ["cnt_001", "cnt_005"],
    "批發": ["cnt_001", "cnt_003"]
  }
}
```

---

## API 設計

### 查詢
```bash
# 查詢所有客戶
contactdb query --type client

# 查詢 VIP 客戶
contactdb query --tag VIP --relationship A

# 搜尋名字
contactdb search "張"

# 查看最近接觸
contactdb recent --days 30
```

### 添加
```bash
# 添加新聯絡人
contactdb add --name "新客戶" --type client --phone "+852XXXXXX"
```

### 更新
```bash
# 更新最後接觸日期
contactdb update cnt_001 --last-contact 2026-02-16

# 添加標籤
contactdb tag cnt_001 --add VIP
```

---

## 強制分析模式整合

### 觸發時機
當用戶提到：
- 人名（如「張生話...」）
- 電話號碼
- 公司名

### 自動動作
1. **檢索**：檢查 contact-database.json
2. **匹配**：嘗試匹配現有 contact
3. **更新**：自動更新 last_contact 日期
4. **提示**：如果係新聯絡人，提示用戶添加

### 回覆格式
```
📇 聯絡人資料：
張志明 (志明珠寶)
• 類型：客戶 (批發)
• 關係：A (VIP)
• 電話：+852XXXXXX
• 最後接觸：2026-02-10 (5日前)
• 備註：注重品質多於價格
```

---

## 示例數據

### 示例 1: 鑽石客戶
```json
{
  "id": "cnt_002",
  "name": "Josh",
  "name_cn": "Josh",
  "type": "client",
  "subtype": "jeweller",
  "relationship_level": "A",
  "contacts": {
    "phone_primary": "+852XXXXXX",
    "phone_secondary": "+852XXXXXX",
    "whatsapp": "+852XXXXXX"
  },
  "tags": ["核心客戶", "珠寶商"],
  "first_contact": "2024-01-01",
  "last_contact": "2026-02-16",
  "contact_frequency": "weekly",
  "notes": "主要合作伙伴，鑽石業務核心客戶"
}
```

### 示例 2: 鑽石供應商
```json
{
  "id": "cnt_010",
  "name": "De Beers HK",
  "type": "supplier",
  "subtype": "diamond",
  "relationship_level": "A",
  "contacts": {
    "phone_primary": "+852XXXXXX",
    "email": "hongkong@debeers.com"
  },
  "company": {
    "name_en": "De Beers Hong Kong",
    "position": "Sales"
  },
  "tags": ["頂級供應商", "RAPAPORT"],
  "first_contact": "2024-03-01",
  "last_contact": "2026-01-15",
  "contact_frequency": "monthly"
}
```

---

## 維護建議

### 定期任務
1. **每週**：檢查有冇聯絡人超過 3 個月冇接觸
2. **每月**：更新 contact_frequency
3. **每季**：review 所有 A 級客戶

### 數據質量
- 確保 phone 同 whatsapp 格式正確
- 定期清理無效 email
- 合併重複記錄

---

## Kimi 實施注意點

1. **儲存格式**：JSON，較易讀寫同搜尋
2. **文件位置**：`memory/contact-database.json`
3. **權限**：同現有 memory 文件相同
4. **備份**：自動備份到 backups folder
5. **整合**：先建立基本結構，後續優化搜尋功能

---

*設計完成：2026-02-16*
*負責人：MiniMax*
