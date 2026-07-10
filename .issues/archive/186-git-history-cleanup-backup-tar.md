---
id: 186
title: Git history cleanup: 剝走 backup tarballs (5GB) — push 太慢
status: archive
priority: P2
created: 2026-07-05
due: 2026-07-12
updated: 2026-07-10
progress: 0/0
---

## F - Facts（事實）

### 現況
`git push origin master` hang 喺 writing objects stage（3 次 timeout），每次 upload ~150MB 後中斷。Root cause 係 historical commits 入面有 **5GB** 嘅 backup tarballs 同 large binaries commit 咗入 git history。

### 數據/證據

| 項目 | 值 |
|------|------|
| `.git/objects/pack/` size | **2.4 GB** (compressed) |
| Estimated total uncompressed | ~5 GB (backup tarballs 2.6GB + 1.3GB + 1.1GB + 8MB each) |
| Push throughput | ~500 KiB/s (HTTPS) |
| Estimated push time | **~3 小時** (at 500 KiB/s for 5GB) |
| HEAD is ahead of remote | **5 commits** (calibration fix + 4 cqm fixes) |
| Backup tarballs in history | 10+ files, date range 2026-05-03 → 2026-06-28 |
| Blob details | `openclaw_backup_20260628_030001.tar.gz` (2.6GB), `openclaw_backup_20260621_030001.tar.gz` (1.3GB), `OpenClaw-HA.zip` (1.1GB) |
| Trigger commit | `11ad601 snapshot: pre-M1.3-batch-2026-06-14` (父 commit `fee266c`) |
| 其他 mixed large blobs | `.skill_review_archive.jsonl` (8.2MB), `sqldb1` (10MB) |

### Timeline

| Time | Event |
|------|-------|
| 2026-05-03 → 06-28 | 10+ backup tarballs committed (通常透過 `snapshot` commit type) |
| 2026-07-05 01:34 | `git add scripts/lib/auditOrchestrator.js` + `git commit 5159e2e` (calibration fix) |
| 2026-07-05 01:34-01:47 | 3x `git push` timeout (60s, 300s, 300s) — 成功 upload ~150MB 但中斷 |
| 2026-07-05 01:47 | Josh approve Option 1 + 2: 放棄 push + 清 tarballs |

## D - Decisions（決定）

### ✅ 已做決定
- **2026-07-05**: Josh 批准 Option 1 (commit 留 local, 唔 push) + Option 2 (開 issue 清 tarballs)
- **2026-07-05**: #186 開嚟追蹤 git history cleanup

### ⏳ 待做決定

| # | Decision | Options | Trigger |
|---|----------|---------|--------|
| **D1** | 用 `git filter-repo` (推薦) 定 `git filter-branch` (slow) ? | filter-repo = 快 (C), filter-branch = 慢但內置 | 工具選用 |
| **D2** | 清完後係 force-push (`--force-with-lease`) 定開新 branch `master-clean`? | force-push = 乾淨, new branch = 安全但分裂 | 清理後策略 |
| **D3** | 清理後點確保唔再 commit backup tarballs? | `.gitignore` `*.tar.gz` / `*.zip` / `*.sqlite` / pre-commit hook | 預防策略 |

## Q - Questions（未解決）

### ❓ 核心問題

1. **`git filter-repo` 已安裝未？** — 最好用 pip / brew 裝一次
2. **Backups 喺 remote 係咪真係有？** — remote 好似從來冇 push 過 history (5 commits diverged)，但 remote `c5e2590` snapshot 係 commit `11ad601` 之前，所以要 force-push 先得
3. **`OpenClaw-HA.zip` (1.1GB) 係邊個 commit 入咗？** — 要 check
4. **5 個 local commits (calibration fix + 4 cqm fixes) 點取捨？** — 全部 commit 有效，但 force-push 時要保留

### 🔍 追問（蘇格拉底反詰）

- **點解唔直接 `.gitignore` + 繼續用？** — 因為 push timeout 係實際問題，唔只係 aesthetic
- **如果淨係用 `--depth=1` shallow push 點？** — 會 break remote history，唔適合持續開發
- **有冇無痛方法保留 backup tarballs 但唔入 git?** — 用 `git lfs` (Large File Storage)、或者放 `~/backups/` 系統定時備份位置
- **點解 2026-05-03 到 06-28 咁多 backup tarballs?** — 之前 `backup_to_bliss.sh` 嘅 tar.gz 輸出直接放咗喺 workspace，然後被 `snapshot` commit 食埋

## Progress

### Phase 1: 準備 (estimated 15min)
- [ ] **Step 1.1**: Check `brew list --formula | grep filter-repo` / `which git-filter-repo`
- [ ] **Step 1.2**: 試 run `git filter-repo --dry-run` — 確認刪除檔案清單符合預期
- [ ] **Step 1.3**: Backup local repo: `cp -a .git .git.backup` (safety net)

### Phase 2: 清理 (estimated 5-10min)
- [ ] **Step 2.1**: `git filter-repo --path-glob '*.tar.gz' --invert-paths --force`
- [ ] **Step 2.2**: `git filter-repo --path-glob '*.zip' --invert-paths --force` (只限大型 backup zip)
- [ ] **Step 2.3**: `git filter-repo --path-glob '*.sqlite' --invert-paths --force` (sqldb1)
- [ ] **Step 2.4**: Verify: `du -sh .git/objects/pack/` should be < 200MB

### Phase 3: 恢復 remote sync (estimated 5-10min)
- [ ] **Step 3.1**: `git push origin master --force-with-lease` — should be fast now (< 10s)
- [ ] **Step 3.2**: Verify: `git log --oneline origin/master -3` match HEAD

### Phase 4: 預防 (estimated 5min)
- [ ] **Step 4.1**: Add to `.gitignore`: `*.tar.gz`, `*.zip`, `*.sqlite`, `*.sqlite.*`
- [ ] **Step 4.2**: Add pre-commit hook blocking >50MB files

### Closing criteria (Day 7)
```
✅ PASS: push 正常 (< 10s), .git/objects/pack/ < 200MB
🟡 PARTIAL: repo cleaned but force-push NOT done (remote still diverged)
🟠 NEEDS MORE: filter-repo errors (unrelated refs/conservativity)
🔴 REGRESSION: force-push broke remote master
```

### Rollback plan
- `cp -a .git.backup .git` — restore full backup
- 或者 `git reset HEAD~1` 還原 commit，再 `git push origin master --force-with-lease` 跟舊 history

### Cross-references
- **Trigger issue:** #182 (calibration fix push hang)
- **Related:** `scripts/backup_to_bliss.sh` (產生 backup tarballs)
- **Related:** `commit 11ad601 snapshot: pre-M1.3-batch-2026-06-14`
- **Related:** `SOUL.md` storage-boundary concern (backups not in workspace)

### Out of scope
- ❌ 唔會剝走 `.backups/` folder (淨係 git history 入面嘅 tarballs)
- ❌ 唔涉及 git LFS migration (overkill for this use case)
- ❌ 唔改 backup_to_bliss.sh (分開 issue)
