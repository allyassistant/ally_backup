/**
 * Skill: Productivity Automation Workflow
 * 
 * 來源: Perplexity Search - Productivity tips systems 2026
 * 創建日期: 2026-02-15
 * 
 * 描述: 自動化工作流程管理，整合 GTD、時間區塊、AI 規劃
 * 
 * Sources:
 * - Work OS: monday.com, Trello with automations
 * - All-in-one: Pocket Informant (tasks + calendar + notes)
 * - AI time-blocking: Sunsama, Motion
 * - Automations: IFTTT, Zapier for routines
 * - AI assistants: ChatGPT, Notion AI
 */

const SKILL_INFO = {
  name: "productivity_automation_workflow",
  version: "1.0.0",
  created: "2026-02-15",
  source: "Perplexity Search",
  description: "自動化工作流程管理，整合任務、日曆、提醒、GTD 系統",
  
  principles: [
    "統一工具而非碎片化",
    "AI 驅動的時間規劃",
    "自動化重複任務",
    "GTD (Getting Things Done)",
    "時間區塊 (Time-blocking)"
  ],
  
  tools: {
    work_os: ["monday.com", "Smartsheet", "Trello"],
    all_in_one: ["Pocket Informant", "Notion"],
    automation: ["IFTTT", "Zapier"],
    ai_assistants: ["ChatGPT", "Notion AI", "Perplexity"],
    calendar: ["Sunsama", "Motion"]
  }
};

/**
 * 分析任務並建議最佳方法
 * @param {string} taskDescription - 任務描述
 * @param {object} context - 上下文（時間、優先級等）
 * @returns {object} - 建議行動
 */
function analyzeTask(taskDescription, context = {}) {
  const taskLower = taskDescription.toLowerCase();
  
  // 任務類型分類
  const taskTypes = {
    quick: {
      keywords: ["quick", "fast", "快", "簡單", "三分鐘"],
      suggestion: "立即執行或委派 AI 處理",
      duration: "< 5 min"
    },
    scheduled: {
      keywords: ["schedule", "meeting", "會議", "約", "排程"],
      suggestion: "加入日曆，設定時間區塊",
      action: "createCalendarEvent"
    },
    delegation: {
      keywords: ["delegate", "委派", "交畀", "assign"],
      suggestion: "委派給 AI 或團隊成員",
      action: "delegateToAgent"
    },
    reference: {
      keywords: ["read", "review", "睇", "睇吓", "參考"],
      suggestion: "歸入參考資料庫，稍後處理",
      action: "saveToReference"
    },
    project: {
      keywords: ["project", "project", "項目", "計劃"],
      suggestion: "分解為子任務，設定里程碑",
      action: "decomposeProject"
    },
    routine: {
      keywords: ["daily", "weekly", "routine", "每日", "每週", "例行"],
      suggestion: "設定自動化規則",
      action: "createAutomation"
    }
  };
  
  // 匹配任務類型
  for (const [type, config] of Object.entries(taskTypes)) {
    if (config.keywords.some(kw => taskLower.includes(kw))) {
      return {
        skill: SKILL_INFO.name,
        task: taskDescription,
        type: type,
        suggestion: config.suggestion,
        suggestedAction: config.action,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  // 預設：需要更多資訊
  return {
    skill: SKILL_INFO.name,
    task: taskDescription,
    type: "unclear",
    suggestion: "需要更多資訊來分類此任務",
    questions: [
      "呢個任務需要幾耐完成？",
      "係咪需要其他人參與？",
      "有冇特定截止時間？"
    ]
  };
}

/**
 * 創建時間區塊
 * @param {object} event - 事件詳情
 * @returns {object} - 時間區塊結構
 */
function createTimeBlock(event) {
  return {
    skill: SKILL_INFO.name,
    type: "time_block",
    event: event,
    structure: {
      title: event.title,
      start: event.startTime,
      end: event.endTime,
      buffer: "15min", // 緩衝時間
      focus: event.requiresFocus ? "deep_work" : "normal",
      breaks: event.duration > 90 ? ["45min 休息一次"] : []
    },
    tips: [
      "喺呢個時段關閉通知",
      "只做呢一樣嘢",
      "完成後即刻記錄進度"
    ]
  };
}

/**
 * 分解項目為子任務
 * @param {string} projectName - 項目名稱
 * @param {object} projectDetails - 項目詳情
 * @returns {array} - 子任務列表
 */
function decomposeProject(projectName, projectDetails = {}) {
  const subtasks = [
    { task: `研究同資料收集`, status: "pending", priority: "high" },
    { task: `制定計劃同大綱`, status: "pending", priority: "high" },
    { task: `執行主要工作`, status: "pending", priority: "medium" },
    { task: `Review 同修改`, status: "pending", priority: "medium" },
    { task: `完成同交付`, status: "pending", priority: "high" }
  ];
  
  return {
    skill: SKILL_INFO.name,
    project: projectName,
    totalTasks: subtasks.length,
    subtasks: subtasks,
    estimatedTime: projectDetails.estimatedHours || "待定",
    recommendedApproach: "使用時間區塊逐個完成",
    nextAction: subtasks[0].task
  };
}

/**
 * 創建自動化規則
 * @param {string} trigger - 觸發條件
 * @param {string} action - 執行動作
 * @returns {object} - 自動化配置
 */
function createAutomation(trigger, action) {
  return {
    skill: SKILL_INFO.name,
    type: "automation",
    trigger: trigger,
    action: action,
    platforms: {
      personal: ["IFTTT", "Zapier"],
      team: ["monday.com", "Trello"],
      ai: ["OpenClaw workflows"]
    },
    example: {
      trigger: "早晨 8:00",
      action: "天氣 + 日曆 + 新聞摘要 自動發送到手機",
      platform: "IFTTT"
    }
  };
}

/**
 * 每日回顧問題
 * @returns {array} - 回顧問題列表
 */
function dailyReviewQuestions() {
  return {
    skill: SKILL_INFO.name,
    type: "daily_review",
    questions: [
      "今日邊三件事最重要？",
      "有冇阻礙我嘅嘢？",
      "明日の優先級係咩？",
      "我從今日學到咗咩？",
      "有冇嘢可以自動化？"
    ],
    outputFormat: {
      completed: "已完成事項",
      blockers: "阻礙",
      priorities: "明日優先",
      learnings: "學習",
      automations: "自動化機會"
    }
  };
}

/**
 * GTD 清空收集箱
 * @param {array} inboxItems - 收集箱項目
 * @returns {object} - 處理結果
 */
function processInbox(inboxItems) {
  const processed = {
    doNow: [],
    schedule: [],
    delegate: [],
    reference: [],
    delete: []
  };
  
  inboxItems.forEach(item => {
    const analysis = analyzeTask(item.description);
    
    switch (analysis.type) {
      case "quick":
        processed.doNow.push(item);
        break;
      case "scheduled":
        processed.schedule.push(item);
        break;
      case "delegation":
        processed.delegate.push(item);
        break;
      case "reference":
        processed.reference.push(item);
        break;
      default:
        processed.reference.push(item); // 預設入參考
    }
  });
  
  return {
    skill: SKILL_INFO.name,
    type: "gtd_process_inbox",
    inputCount: inboxItems.length,
    processed: processed,
    nextActions: {
      doNow: "宜家開始做",
      schedule: "放入日曆",
      delegate: "委派出去",
      reference: "歸檔備查"
    }
  };
}

module.exports = {
  skill: SKILL_INFO,
  analyzeTask,
  createTimeBlock,
  decomposeProject,
  createAutomation,
  dailyReviewQuestions,
  processInbox
};
