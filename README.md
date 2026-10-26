# 宝宝笔记 Web 版

宝宝笔记的 Web 客户端:React SPA + Hono API,部署在 Cloudflare Workers 上,数据保存在 D1。
功能与 iOS / Android 版一一对应:

- 7 种记录:喂奶、体重、药物、检查、胎动、血糖、屎尿
- 快速记录页:距上次喂奶实时计时、3小时奶量统计、奶量快捷选择、一键喂奶/屎/尿、按天记录列表带筛选、行内奶量 ±10(0.45s 防抖落库)
- 首页概览、时间线(筛选/编辑/删除)、统计(喂奶/体重 SVG 折线图/屎尿/血糖柱状图 + 妊娠期控糖阈值对比)
- 喂奶趋势支持全部历史与 14/30/90 天快捷范围；时间轴两端可拖选起止日期，中间可平移所选时段，三个趋势图与日均奶量、每顿平均、每天顿数、最长间隔同步更新。日均按所选日历天数计算（包含无记录日和今天），对比前一个等长时段；最长间隔仅取选区内的喂奶记录。
- 喂奶超时闹钟:WebAudio 合成柔和钟声持续响铃(音量渐增)+ 震动 + 全屏提醒,触屏停止,手动停止后延后 1 小时(需保持页面打开)
- 屏幕:通过 Wake Lock 保持 iPad 常亮
- 简单密码登录(HMAC 签名 cookie,长期有效并自动续期)

## 技术栈

- 后端:Cloudflare Workers + Hono + D1(SQLite)
- 前端:Vite + React + TypeScript,无 UI 框架依赖,移动优先
- 登录密码和签名密钥通过 Workers Secrets 配置

## 本地开发

```bash
npm install
npm run db:migrate:local        # 初始化本地 D1(仅第一次)
npm run dev                     # 构建前端并启动 wrangler dev(http://localhost:8787)
```

本地密码在 `.dev.vars` 里(默认 `babynote-dev`)。

## 放大计时的喂奶记录

放大后的喂奶按钮固定记录 120 ml，不再根据历史记录或喂奶间隔估算奶量。保存后可在今天记录中调整实际奶量。

## 分享给家人

在「设置 → 分享 Key」为不同家人创建多个独立链接，填写名称并选择：

- 权限：只读，或读写（可添加、修改和删除记录）。
- 有效期：永久、1 天、7 天或 30 天。

Key 保存在 D1，刷新或换设备后仍可查看和复制。列表显示权限、有效期、创建时间、最近登录及启停状态。
停用或到期会同时阻止链接登录和现有会话继续访问；启用不会延长到期时间。
只有密码登录的管理员可管理 Key，读写分享访客也不能创建或管理其他 Key。

链接使用独立随机 ID 与签名，不包含访问密码；打开后凭证会从地址栏移除。
旧版单次生成的限时链接不再支持，需要在新列表中重新创建。
跨设备分享请在正式网站创建，localhost 链接只能用于本机测试。
本功能需要先应用 `0004_share_keys.sql` 数据库迁移（本地使用 `npm run db:migrate:local`，发布前使用对应的远程迁移命令）。

## 部署到 Cloudflare

1. 登录并创建 D1 数据库:

   ```bash
   npx wrangler login
   npx wrangler d1 create babynote
   ```

   把命令输出的 `database_id` 填进 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

2. 初始化线上数据库表:

   ```bash
   npm run db:migrate:remote
   ```

3. 设置访问密码和签名密钥(输入时不会回显):

   ```bash
   npx wrangler secret put AUTH_PASSWORD    # 你的登录密码
   npx wrangler secret put AUTH_SECRET      # 随便一串长随机字符串,用于签 cookie
   ```

4. 部署:

   ```bash
   npm run deploy
   ```

   完成后会得到 `https://babynote.<你的子域>.workers.dev`,手机浏览器打开即可使用,也可以"添加到主屏幕"当 App 用。

## API 摘要

- `POST /api/login` `{password}` → 设置会话 cookie
- `POST /api/logout`
- `GET /api/records` → 一次返回全部 7 类记录(按时间倒序)
- `POST /api/:kind` / `PUT /api/:kind/:id` / `DELETE /api/:kind/:id`
  (`kind` ∈ feeding | weight | medication | checkup | fetalMovement | bloodGlucose | excretion)

## 说明

- 喂奶闹钟和调暗是页面内机制,浏览器标签页关闭后不会触发。
- 设置(闹钟开关/延迟、常亮)保存在浏览器 localStorage,按设备独立。
- 数据在云端 D1,多设备打开同一地址即共享。

## 阿里云独立部署

支持 Node.js 22.13+ / SQLite / Nginx，Cloudflare 部署入口继续保留。共享业务接口位于
`worker/app.ts`，两种运行时仅使用各自的数据库和 WebSocket 适配器。

```bash
npm ci
npm run typecheck
npm test                       # 包含构建和独立运行时集成测试
AUTH_PASSWORD='设置网站密码' AUTH_SECRET='设置随机签名密钥' npm run start:server
```

默认监听 `127.0.0.1:3000`，数据库为 `data/babynote.sqlite`，启动时自动应用 `migrations/`。
可通过 `HOST`、`PORT`、`DATABASE_PATH` 覆盖。默认 Cookie 要求 HTTPS；仅在临时 HTTP 验证时
设置 `COOKIE_SECURE=false`。AI 解读需要单独提供 `DEEPSEEK_API_KEY`，可选 `DEEPSEEK_MODEL`。

`aliyun-baby` 部署目录和运维配置：

- 程序：`/opt/babynote/current`，历史构建在 `/opt/babynote/releases/`。
- 数据：`/var/lib/babynote/babynote.sqlite`；密钥：`/etc/babynote.env`（仅 root 可读）。
- 服务：`babynote.service`，以专用系统用户运行，Nginx 代理 HTTP 与 WebSocket。
- 备份：`babynote-backup.timer`，服务器时区每天 03:30 起的五分钟内执行，保留约 14 天。
  备份在 `/var/backups/babynote/`，使用 SQLite 在线备份并校验完整性。
- 模板位于 `deploy/`。首次部署需安装 Node.js、Nginx、sqlite3，创建 `babynote` 系统用户，
  安装模板并导入数据；后续更新执行 `bash scripts/deploy-aliyun.sh`。
  更新脚本先构建测试再切换版本，健康检查失败时回滚到上个程序版本；不会回滚数据库迁移。

```bash
ssh aliyun-baby 'systemctl status babynote --no-pager'
ssh aliyun-baby 'journalctl -u babynote -n 50 --no-pager'
ssh aliyun-baby 'systemctl start babynote-backup.service'
```

2026-10-23 已将当前工作区（包含未提交改动）部署到 `http://101.200.170.181`，
导入当日 22:11（Asia/Shanghai）Cloudflare 数据快照：743 条喂奶记录、175 条排泄记录、
2 个分享 Key；其中 35 条记录在回收站。逐表数据摘要、ID 和自增序列与快照一致。
`babynote.baby` 继续指向原站点。两站数据独立，后续不会自动互相同步；正式切换前需重新
协调数据。新站使用新签名密钥，旧分享链接须在新站重新复制。新服务器尚未配置 DeepSeek Key。


### babynode.cn 与 HTTPS

2026-10-23 已绑定 `https://babynode.cn` 和 `https://www.babynode.cn`，使用 Let's Encrypt 证书。
域名的 HTTP 访问会跳转到 `https://babynode.cn`。网站密码保持不变，
`/etc/babynote.env` 已设置 `COOKIE_SECURE=true`；域名首次访问需要重新登录。

DNS 的 `@` 和 `www` A 记录指向 `101.200.170.181`。首次安装 HTTPS 模板前，先通过
HTTP 提供 `/var/www/letsencrypt/.well-known/acme-challenge/`，申请证书后再安装 `deploy/nginx.conf`：

```bash
certbot certonly --webroot -w /var/www/letsencrypt -d babynode.cn -d www.babynode.cn
```

`certbot.timer` 自动续期；`deploy/renew-cert.sh` 安装到
`/etc/letsencrypt/renewal-hooks/deploy/reload-nginx`，证书更新后检查并重载 Nginx。
保留 HTTP 的 ACME 路由供续期使用。检查命令：

```bash
ssh aliyun-baby 'certbot certificates'
ssh aliyun-baby 'systemctl list-timers certbot.timer'
ssh aliyun-baby 'certbot renew --dry-run --no-random-sleep-on-renew --run-deploy-hooks'
```

### IP 直接访问

2026-10-24 确认域名请求受到阿里云备案拦截。新增独立的
`https://101.200.170.181` 入口，使用可信的 Let's Encrypt IP 证书，与域名入口共用
同一应用和数据库。HTTP IP 请求仅跳转到 HTTPS IP，不再跳转到域名。
保持 `COOKIE_SECURE=true`，不提供明文登录入口。

IP 证书采用 `shortlived` 配置，有效期约 6 天。独立 Certbot 5.8 环境位于
`/opt/babynote-certbot`，证书位于 `/etc/letsencrypt-ip/live/babynote-ip/`，
避免原系统 Certbot 4 的域名续期任务读取不支持的 IP 配置。
`deploy/babynote-ip-cert-renew.timer` 每天两次检查续期；
`deploy/renew-cert.sh` 安装至 `/etc/letsencrypt-ip/renewal-hooks/deploy/reload-nginx`，
续期后检查并重载 Nginx。重新安装 `deploy/nginx.conf` 前应确保域名与 IP 证书均已存在。

```bash
ssh aliyun-baby 'systemctl list-timers babynote-ip-cert-renew.timer'
ssh aliyun-baby 'systemctl start babynote-ip-cert-renew.service'
ssh aliyun-baby 'journalctl -u babynote-ip-cert-renew.service -n 30 --no-pager'
```

### 旧 iPad App 数据导入

2026-10-24 已从 iPad 的原生 `com.frank.babynote` App 导入 900 条历史记录：
喂奶 460 条、排泄 357 条、血糖 74 条、体重 8 条、用药 1 条。
用户指定跳过来自首次启动示例的 1 条检查记录和 1 条胎动记录。
13 条旧版左侧／右侧母乳记录映射为 `mixed`，原始侧别追加保存在备注中。
原 App 数据保持不变，导入后两端不会自动同步。

原始 SQLite/WAL、合并后的源数据快照、导入前网站备份与报告保存在服务器私有目录
`/var/backups/babynote/ipad-import-20261024/`。
迁移脚本 `scripts/import-ipad-data.py` 默认只做预览；`--apply` 必须同时指定一个尚不存在的
`--backup` 路径。脚本在事务中只新增记录，保留现有记录、回收站和分享 Key；按完整字段和
重复次数去重，同一批数据重复导入不会再次新增。相同时间但字段冲突时中止，等待人工核对。

```bash
python3 scripts/import-ipad-data.py \
  --source /path/to/native-snapshot.sqlite \
  --target /path/to/babynote.sqlite \
  --skip-demo --report /path/to/import-preview.json
```
