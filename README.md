# Gists Client

轻量级 GitHub Gist 桌面客户端。Tauri + React + Monaco Editor + SQLite，无任何系统级依赖（含 git）。

## 功能特性

| 功能 | 说明 |
|------|------|
| 离线访问 | SQLite 本地缓存，无网络也可浏览/编辑 |
| ETag 增量同步 | `If-None-Match` 条件请求，仅拉取变更内容，节省 API 配额 |
| 草稿保存 | 编辑后 1.5 s 自动写入本地 DB（`pending_push=1`），手动点击「同步到 GitHub」再推送 |
| 冲突检测 | 后台同步更新了正在编辑的 Gist 时，弹出「Keep mine / Take remote」横幅 |
| Markdown 预览 | 源码 / 预览 / 分栏三模式；支持 GFM 表格、任务列表、Mermaid 图表（懒加载 SVG） |
| 全文搜索 | FTS5 BM25 排名；`tag:X` `lang:Y` `is:public` 结构化过滤，白名单字符防注入 |
| 自动分类 | 启发式引擎按文件扩展名/内容自动归类（10 类），用户可锁定 |
| 标签系统 | 用户自定义标签 + 自定义颜色，侧边栏单标签过滤 |
| Diff 查看 | Working tree diff（本地 SQLite 快照）+ Revisions 时间线（GitHub API），无需 git |
| 多文件 Tab | 单个 Gist 多文件切换编辑 |
| 快捷键 | `⌘K` 搜索 · `⌘R` 同步 · `⌘N` 新建 |
| 深色模式 | 自动跟随系统偏好 |
| 极速启动 | Tauri 原生壳，内存 <50 MB，启动 <1 s |

## 技术栈

```
Tauri 1.5          — 原生桌面框架 (Rust)
React 18.2         — UI 框架
Zustand 4.4        — 极简状态管理
Monaco Editor 0.44 — VS Code 同款编辑器
rusqlite 0.31      — SQLite（bundled，零系统依赖）
reqwest 0.11       — HTTP 客户端（rustls，无 OpenSSL）
similar 2          — 纯 Rust Myers diff 算法
keyring 2          — OS 密钥链存储（Keychain / Credential Manager / keyutils）
react-markdown 10  — Markdown 渲染（remark-gfm 4 + mermaid 11）
```

## 项目结构

```
gists-client/
├── src/                          # React 前端
│   ├── api/
│   │   └── tauri.ts              # Tauri IPC 类型化封装（27 条命令）
│   ├── store/
│   │   └── useGistStore.ts       # Zustand 全局状态 + 所有异步 actions
│   ├── hooks/
│   │   ├── useDebounce.ts        # 泛型防抖（自动保存 / Markdown 预览）
│   │   └── useKeyboard.ts        # 全局快捷键（⌘K / ⌘R / ⌘N）
│   ├── components/
│   │   ├── TokenSetup.tsx        # GitHub Token 配置页（格式校验）
│   │   ├── Layout.tsx            # 整体布局（启动时加载缓存 + 触发同步）
│   │   ├── Toolbar.tsx           # 顶部工具栏（同步状态 / 登录名 / 登出）
│   │   ├── Sidebar.tsx           # 左侧列表 + 搜索 + 分类/标签过滤
│   │   ├── Editor.tsx            # Monaco 编辑器 + 草稿保存 + 冲突检测 + Markdown 分栏
│   │   ├── MarkdownPreview.tsx   # react-markdown 渲染（GFM + Mermaid，skipHtml）
│   │   ├── MermaidBlock.tsx      # Mermaid 懒加载 SVG 渲染（带 unmount 取消）
│   │   ├── DiffModal.tsx         # Revisions 时间线 + Working tree diff
│   │   └── TagInput.tsx          # 标签选择器（Chips + 下拉 + 自动颜色）
│   ├── styles/
│   │   └── global.css            # 极简深色主题 CSS
│   ├── App.tsx                   # 入口：Token 守卫 → Layout
│   └── main.tsx
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # Tauri builder、DB 初始化、Token 恢复
│   │   ├── db.rs                 # SQLite 初始化（WAL + FK）、FTS v2 迁移、设置 CRUD
│   │   ├── models.rs             # 共享类型（Gist、GistFile、CategoryCount …）
│   │   ├── github.rs             # GitHub REST API 客户端（ETag、分页、速率限制退避）
│   │   ├── cache.rs              # SQLite 缓存层（事务 upsert / FTS / 快照）
│   │   ├── commands.rs           # 27 条 Tauri IPC 命令（含 keyring 辅助函数）
│   │   ├── classifier.rs         # 启发式分类引擎（category + lang_group）
│   │   ├── search_parser.rs      # 搜索语法解析（tag: / lang: / is: / 关键词）
│   │   └── diff.rs               # 纯 Rust unified diff（similar crate，无 git）
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
│
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 数据库设计

```sql
-- 主表：Gist 元数据 + 分类
CREATE TABLE gists (
  id                TEXT    PRIMARY KEY,
  description       TEXT    NOT NULL DEFAULT '',
  public            INTEGER NOT NULL DEFAULT 0,     -- 0=secret 1=public
  html_url          TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  synced_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  pending_push      INTEGER NOT NULL DEFAULT 0,     -- 本地草稿标志
  remote_etag       TEXT,                            -- If-None-Match 缓存
  category          TEXT    NOT NULL DEFAULT 'gist',-- 自动/用户分类
  lang_group        TEXT    NOT NULL DEFAULT 'other',-- 语言分组
  category_user_set INTEGER NOT NULL DEFAULT 0      -- 用户锁定分类标志
);

-- 文件内容（CASCADE 删除）
CREATE TABLE files (
  gist_id   TEXT    NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
  filename  TEXT    NOT NULL,
  language  TEXT,
  content   TEXT    NOT NULL DEFAULT '',
  size      INTEGER NOT NULL DEFAULT 0,
  raw_url   TEXT,
  PRIMARY KEY (gist_id, filename)
);

-- FTS5 全文搜索 v2（描述 + 文件名 + 文件内容，unicode61 分词器，BM25 排名）
CREATE VIRTUAL TABLE gists_fts USING fts5(
  gist_id      UNINDEXED,
  description,
  filenames,
  content_text,
  tokenize = 'unicode61'
);

-- 键值设置（token、gh_login、last_sync、fts_version …）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 用户标签
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT    NOT NULL DEFAULT '#8b949e'
);

-- Gist ↔ Tag 多对多
CREATE TABLE gist_tags (
  gist_id TEXT    NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (gist_id, tag_id)
);

-- 最后一次 GitHub 同步的文件内容快照（Working tree diff baseline）
CREATE TABLE files_remote_snapshot (
  gist_id   TEXT NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
  filename  TEXT NOT NULL,
  content   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (gist_id, filename)
);
```

## 同步 & 编辑流程

```
启动
  └─ 从 DB 加载缓存（立即显示，可离线浏览）
  └─ 恢复 Token：OS 密钥链 → SQLite fallback
  └─ 后台增量同步：GET /gists?since=<last_sync>
       └─ 每个 Gist：If-None-Match ETag → 304 跳过 / 200 写入
            └─ pending_push=1 的 Gist 只更新元数据，不覆盖编辑内容
            └─ 速率限制：X-RateLimit-Remaining=0 → 休眠至 Reset 时间（最多 5 分钟）

编辑
  └─ Monaco onChange
  └─ useDebounce(1500 ms)
  └─ save_gist_draft → 写 SQLite，pending_push=1（不调用 GitHub API）
  └─ 后台同步检测到 updated_at 变化（同时 isDirty=true）→ 冲突横幅
       └─ "Keep mine"  → PATCH /gists/:id（本地覆盖远端）
       └─ "Take remote"→ 重新拉取远端，丢弃本地草稿
  └─ 用户点击「同步到 GitHub」（需 pending_push=1 且 isDirty=false）
       └─ PATCH /gists/:id → 200 → upsert 缓存，pending_push=0
                                  → 更新 files_remote_snapshot

Diff
  └─ Working tree：编辑器内容 vs files_remote_snapshot（纯本地，similar crate）
  └─ Revisions：GET /gists/:id/commits → 按需 GET /gists/:id/:sha → Myers diff
```

## 搜索语法

| 语法 | 示例 | 含义 |
|------|------|------|
| 关键词 | `async rust` | FTS5 BM25 全文匹配（描述 + 文件名 + 内容） |
| `tag:` | `tag:work` | 按标签名过滤（大小写不敏感） |
| `lang:` | `lang:python` | 按文件语言过滤 |
| `is:` | `is:public` / `is:secret` | 按可见性过滤（`is:private` 同 `is:secret`） |
| 组合 | `tag:notes lang:markdown is:secret` | 多条件 AND 交集 |

> 关键词白名单：字母、数字、`-`、`_`、`.`；其余字符自动过滤，防止 FTS5 MATCH 注入。

## 自动分类

| 分类 | 典型文件/识别规则 |
|------|-----------------|
| `config` | `.env`, `*.toml`, `*.yaml`, `Dockerfile`, `*.conf`, `*.json` … |
| `script` | `*.sh`, `*.ps1`, `*.bat`，含 shebang 行，单文件短 Python/Ruby |
| `document` | `*.md`, `*.rst`, `*.txt`, `*.adoc`, `*.org` … |
| `media` | 图片/音视频/PDF 扩展名 |
| `data` | `*.csv`, `*.sql`, `*.parquet`, `*.xlsx`, `*.sqlite` … |
| `library` | `lib.rs`, `index.ts`, `__init__.py` |
| `test` | 文件名含 `test` / `spec`，或内容含 `#[test]` / `describe(` |
| `snippet` | 单文件 < 50 行 |
| `multi` | 3 个及以上混合文件 |
| `gist` | 默认分类 |

## 安全机制

| 层级 | 措施 |
|------|------|
| Token 存储 | 优先写入 OS 密钥链（`keyring` crate：macOS Keychain / Windows Credential Manager / Linux keyutils）；若密钥链不可用则 fallback 到 SQLite |
| Token 格式校验 | 本地预检：非空 + 前缀必须为 `ghp_` / `ghu_` / `gho_` / `ghs_` / `github_pat_`，长度 ≥ 20 |
| Token 验证 | 调用 `GET /user` 确认有效后才持久化 |
| FTS5 注入防护 | 关键词白名单过滤（仅保留字母数字 + `-_.`） |
| Markdown XSS | `react-markdown` 设置 `skipHtml={true}`，屏蔽 Gist 内容中的原始 HTML |
| 数据库 | WAL 模式 + Foreign Keys；`upsert_gists_with_etags` 使用 `conn.transaction()` 自动回滚 |
| 并发写入 | Editor 层 `isWriting` ref 互斥锁，防止自动保存与冲突解决并发竞争 |
| HTTP 客户端 | rustls（无 OpenSSL），所有请求携带 `User-Agent: gists-client/0.1` |
| 速率限制退避 | 读取 `X-RateLimit-Remaining`；耗尽时休眠至 `X-RateLimit-Reset`（上限 5 分钟）；低于 10 时打印警告 |

## 快速开始

### 前置要求

- [Rust 1.70+](https://rustup.rs/)
- [Node.js 18+](https://nodejs.org/)
- [Tauri v1 系统依赖](https://tauri.app/v1/guides/getting-started/prerequisites)（WebKitGTK / libsoup 等）

### 安装 & 运行

```bash
npm install
npm run tauri dev
```

### 生产构建

```bash
npm run tauri build
```

## 数据库位置

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/com.gists-client.app/gists.db` |
| Linux | `~/.local/share/com.gists-client.app/gists.db` |
| Windows | `%APPDATA%\com.gists-client.app\gists.db` |

## 已知限制

| 限制 | 说明 |
|------|------|
| Token 双存储 | Token 写入 OS 密钥链的同时仍 fallback 保存在 SQLite 明文中；生产环境建议集成 `tauri-plugin-stronghold` 去掉 SQLite fallback |
| `files_changed` 字段 | `GistRevisionView::files_changed` 固定为 0，GitHub Commits API 不返回此字段 |
| 无手动合并 | 冲突解决只有「保留本地」和「取远端」两种选择，不支持三路合并 |
| 系统密钥链 | 无桌面 Session 的 Linux 环境（CI/容器）keyutils 可能不可用，自动降级为 SQLite 存储 |
| GitHub API 版本 | 固定使用 `2022-11-28`，建议随 GitHub 文档更新 |
