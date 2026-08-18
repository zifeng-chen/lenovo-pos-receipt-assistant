# 门店小票打印助手

面向联想门店的本地小票处理工具，用于将商务存根和购物小票组合到一张 A4 纸上进行预览、打印或导出，同时记录每日销售金额并展示今日统计、销售明细和近 30 天趋势。

项目采用前后端分离结构。图片只在浏览器中以 DataURL 形式处理，不会上传到服务器；销售数据保存在本机 SQLite 文件中。

## 功能概览

### 小票组合与输出

- 左右双栏界面：左侧操作面板，右侧 A4 纸张预览。
- A4 预览区分为左右两部分：
  - 左侧放置商务存根。
  - 右侧放置购物小票。
- 两个图片区均支持点击选择文件和直接拖入图片。
- 支持浏览器可识别的图片格式，推荐使用 JPG、PNG 或 WEBP。
- 单张图片最大允许 20MB。
- 图片使用 `object-fit: contain` 等比缩放，不会被拉伸变形。
- 当前排版规则：
  - 商务存根贴近 A4 底部，底部间距为 `0`。
  - 购物小票顶部距离 A4 纸张顶部 `85px`。
- “清除图片”可以同时移除存根和购物小票。
- “打印小票”通过浏览器原生打印能力输出一张 A4 纵向页面。
- “下载组合图”使用 html2canvas 将完整 A4 预览导出为 PNG。
- 打印和下载前必须先上传存根、购物小票两张图片。

### 销售记录

- 输入销售金额后保存，销售日期由后端根据门店电脑本地日期自动生成。
- 金额必须大于 0，后端统一保留两位小数。
- 今日统计只计算状态为“正常”的销售记录：
  - 今日销售笔数。
  - 今日销售总额。
- 销售记录表显示全部历史记录及其当前状态。
- 每条记录可以撤销或恢复：
  - `status = 1`：正常，计入统计和趋势。
  - `status = 0`：已撤销，不计入统计和趋势。
- 近 30 天销售趋势按天汇总正常记录；没有销售的日期自动补为 0。

## 技术栈

| 层级 | 技术 | 当前版本 | 用途 |
| --- | --- | --- | --- |
| 前端框架 | Vue | 3.5.13 | 页面组件与响应式状态 |
| 构建工具 | Vite | 4.5.14 | 开发服务和生产构建 |
| UI 组件 | Element Plus | 2.14.4 | 输入框、按钮、表格和消息提示 |
| HTTP 客户端 | Axios | 1.19.0 | 调用后端 API |
| 图表 | ECharts | 6.1.0 | 近 30 天销售趋势 |
| 图片导出 | html2canvas | 1.4.1 | A4 预览导出 PNG |
| 后端 | Express | 4.22.2 | REST API |
| 数据库 | better-sqlite3 | 9.6.0 | 本地 SQLite 持久化 |
| 跨域 | cors | 2.8.5 | 限制允许访问 API 的前端来源 |

## 项目结构

```text
.
├── .gitignore                 # Git 忽略规则
├── .nvmrc                     # 推荐 Node.js 版本
├── README.md                  # 项目文档
├── backend/
│   ├── db/
│   │   └── database.sqlite    # 运行时自动创建，不提交到 Git
│   ├── package.json
│   ├── package-lock.json
│   └── server.js              # Express、SQLite 初始化和全部 API
└── frontend/
    ├── src/
    │   ├── App.vue            # 主界面及全部业务交互
    │   ├── api.js             # Axios 客户端
    │   ├── main.js            # Vue 入口
    │   └── style.css          # 页面、A4 预览和打印样式
    ├── index.html
    ├── package.json
    ├── package-lock.json
    └── vite.config.js         # Vite 配置及 /api 代理
```

`node_modules`、前端 `dist` 以及 SQLite 数据库文件都已加入 `.gitignore`，不会上传到 GitHub。

## 环境要求

- macOS、Windows 或 Linux。
- Node.js `16.17.1` 或更高版本。
- npm `8` 或更高版本。
- 推荐使用项目 `.nvmrc` 中指定的 Node.js `16.17.1`。

如果本机安装了 nvm，在项目根目录执行：

```bash
nvm use
```

如果尚未安装该版本：

```bash
nvm install 16.17.1
nvm use 16.17.1
```

## 安装依赖

克隆仓库：

```bash
git clone https://github.com/zifeng-chen/lenovo-pos-receipt-assistant.git
cd lenovo-pos-receipt-assistant
nvm use
```

安装后端依赖：

```bash
cd backend
npm install
```

安装前端依赖：

```bash
cd ../frontend
npm install
```

依赖版本已通过 `package-lock.json` 锁定。如果需要严格按照锁文件安装，可以使用：

```bash
npm ci
```

## 启动项目

项目需要同时启动后端和前端，请准备两个终端窗口。

### 1. 启动后端

```bash
cd backend
npm start
```

也可以直接运行：

```bash
node server.js
```

默认后端地址：

```text
http://127.0.0.1:3000
```

后端仅绑定本机回环地址 `127.0.0.1`，不会直接暴露给局域网中的其他设备。可以通过 `PORT` 环境变量修改端口，例如：

```bash
PORT=3100 npm start
```

如果修改了后端端口，还需要同步修改 `frontend/vite.config.js` 中的代理目标。

### 2. 启动前端

在另一个终端中执行：

```bash
cd frontend
npm run dev
```

默认访问地址：

```text
http://localhost:5173
```

Vite 会把浏览器发往 `/api` 的请求代理到 `http://127.0.0.1:3000`。

## 使用流程

### 1. 上传存根和购物小票

1. 在右侧 A4 预览区点击左半区，选择商务存根图片；也可以把图片拖入左半区。
2. 点击右半区，选择购物小票图片；也可以把图片拖入右半区。
3. 图片读取完成后会立即显示在 A4 预览中。
4. 如需重新选择，直接点击对应区域并选择另一张图片即可覆盖。

图片完全保存在当前浏览器页面内。刷新或关闭页面后，已选择图片会被清除，不会写入数据库。

### 2. 记录销售金额

1. 在左侧“录入销售金额”区域输入金额。
2. 点击“保存记录”，或在输入框内按 Enter。
3. 后端自动使用门店电脑当前日期写入记录。
4. 保存成功后，销售列表、今日统计和趋势图会自动刷新。

### 3. 撤销或恢复记录

- 正常记录右侧显示“撤销”。点击后，该记录仍保留在数据库中，但不再计入今日统计和趋势。
- 已撤销记录右侧显示“恢复”。点击后会重新计入对应日期的销售统计。
- 系统采用状态切换而不是物理删除，便于保留操作痕迹。

### 4. 打印 A4

1. 确认存根和购物小票都已上传。
2. 点击左侧蓝色“打印小票”按钮。
3. 在浏览器打印对话框中选择 A4、纵向。
4. 推荐设置：
   - 纸张：A4。
   - 方向：纵向。
   - 缩放：100% 或默认。
   - 页边距：无。
   - 关闭浏览器页眉和页脚。
5. 打印样式只保留 A4 组合预览，并限制为一页；操作面板、标题和其他页面内容不会打印。

不同浏览器和打印机驱动的打印设置可能不同。若预览仍出现额外空白页，优先确认纸张为 A4、边距为“无”、缩放为 100%，并关闭页眉页脚。

### 5. 下载组合图

1. 确认两张图片均已上传。
2. 点击“下载组合图”。
3. 浏览器会生成并下载：

```text
小票组合_YYYY-MM-DD.png
```

导出时使用 2 倍渲染比例和白色背景，以提高图片清晰度。

## API 文档

开发环境中前端通过 `/api` 代理访问后端。直接调用后端时，基础地址为：

```text
http://127.0.0.1:3000/api
```

### 新增销售记录

```http
POST /api/sales
Content-Type: application/json
```

请求体：

```json
{
  "amount": 1280.5
}
```

成功响应：`201 Created`

```json
{
  "id": 1,
  "sale_date": "2026-08-18",
  "amount": 1280.5,
  "status": 1,
  "created_at": "2026-08-18 06:00:00"
}
```

日期由后端自动生成，客户端不能指定。金额无效或小于等于 0 时返回 `400 Bad Request`。

### 查询销售记录

```http
GET /api/sales
```

可选查询参数：

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `status` | 空 | 返回全部记录 |
| `status` | `1` | 只返回正常记录 |
| `status` | `0` | 只返回已撤销记录 |

记录按 `created_at` 和 `id` 倒序返回。

### 切换记录状态

```http
PUT /api/sales/:id/toggle
```

- 正常记录调用后变为已撤销。
- 已撤销记录调用后恢复正常。
- ID 无效时返回 `400 Bad Request`。
- 记录不存在时返回 `404 Not Found`。

### 获取今日统计

```http
GET /api/sales/today
```

响应：

```json
{
  "count": 5,
  "total": 1280.5
}
```

只统计 `sale_date` 等于后端本地日期并且 `status = 1` 的记录。

### 获取近 30 天趋势

```http
GET /api/sales/trend
```

响应固定包含从 29 天前到今天的 30 个数据点：

```json
[
  {
    "date": "2026-07-20",
    "total": 0
  },
  {
    "date": "2026-08-18",
    "total": 1280.5
  }
]
```

只有正常记录参与汇总，没有销售记录的日期返回 `total: 0`。

## 数据库

数据库路径：

```text
backend/db/database.sqlite
```

后端首次启动时会自动创建目录、数据库文件和 `sales` 表，无需手动初始化。

建表结构：

```sql
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER | 自增主键 |
| `sale_date` | TEXT | 门店电脑本地销售日期，格式为 `YYYY-MM-DD` |
| `amount` | REAL | 销售金额 |
| `status` | INTEGER | `1` 正常，`0` 已撤销 |
| `created_at` | TEXT | SQLite 自动生成的创建时间 |

数据库启用了 WAL 日志模式和 5 秒 busy timeout，以提高本地读写稳定性。

## 数据备份与恢复

数据库文件不会上传到 GitHub，需要门店自行备份。

### 推荐备份方法

1. 停止后端服务，确保数据库没有正在进行的写入。
2. 复制 `backend/db/database.sqlite` 到安全位置。
3. 使用日期命名备份文件，例如：

```text
database-2026-08-18.sqlite
```

### 恢复方法

1. 停止后端服务。
2. 将备份文件复制回 `backend/db/`。
3. 将文件名改为 `database.sqlite`。
4. 重新启动后端。

不要在后端运行期间直接覆盖数据库文件。由于项目启用了 WAL 模式，运行时还可能出现 `database.sqlite-wal` 和 `database.sqlite-shm`，这些文件同样不会提交到 Git。

## 构建前端

生成生产构建：

```bash
cd frontend
npm run build
```

构建结果位于：

```text
frontend/dist
```

本地预览构建结果：

```bash
npm run preview
```

`dist` 是生成目录，已被 Git 忽略。

## 安全与部署说明

- 后端只监听 `127.0.0.1`，设计目标是门店单机使用。
- CORS 只允许以下开发地址：
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
- 图片不会发送到 Express，也不会写入 SQLite。
- 项目目前没有用户登录和权限系统，不应在未增加鉴权、HTTPS 和访问控制的情况下直接暴露到公网。
- 如果需要让局域网其他电脑访问，应先设计身份认证、权限控制、备份和网络安全方案，而不是简单修改监听地址。

## 常见问题

### 前端提示“数据加载失败”

确认后端已经启动，并访问：

```text
http://127.0.0.1:3000/api/sales/today
```

如果能看到 JSON，说明后端工作正常。然后检查 `frontend/vite.config.js` 的代理端口是否与后端一致。

### 端口已被占用

macOS 或 Linux 可以检查端口进程：

```bash
lsof -i :3000
lsof -i :5173
```

停止冲突进程，或调整对应服务端口。

### better-sqlite3 安装失败

优先确认 Node.js 版本与 `.nvmrc` 一致，然后重新安装：

```bash
nvm use
cd backend
rm -rf node_modules
npm ci
```

如果本机没有可用的预编译二进制，可能需要安装 C/C++ 编译工具。macOS 可安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

### 图片无法显示

- 确认文件是浏览器支持的图片格式。
- 确认单张图片不超过 20MB。
- 尝试转换为 JPG 或 PNG 后重新上传。
- 点击上传同一文件时，前端会重置文件输入，因此可以重复选择同一张图片。

### 打印出现两页

- 纸张选择 A4。
- 方向选择纵向。
- 页边距选择“无”。
- 关闭浏览器页眉和页脚。
- 缩放使用 100% 或默认值，不要启用额外放大。
- 推荐使用最新版 Chrome 或 Edge 打印。

## 开发检查

修改前端后执行：

```bash
cd frontend
npm run build
```

检查生产依赖安全审计：

```bash
cd frontend
npm audit --omit=dev

cd ../backend
npm audit --omit=dev
```

当前项目没有配置自动化测试脚本，涉及金额统计、日期、打印样式或数据库逻辑的改动应至少执行前端构建和后端 API 冒烟验证。

## 仓库地址

GitHub：<https://github.com/zifeng-chen/lenovo-pos-receipt-assistant>
