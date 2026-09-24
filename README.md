# 宝宝笔记 Web 版

宝宝笔记的 Web 客户端:React SPA + Hono API,部署在 Cloudflare Workers 上,数据保存在 D1。
功能与 iOS / Android 版一一对应:

- 7 种记录:喂奶、体重、药物、检查、胎动、血糖、屎尿
- 快速记录页:距上次喂奶实时计时、3小时奶量统计、奶量快捷选择、一键喂奶/屎/尿、按天记录列表带筛选、行内奶量 ±10(0.45s 防抖落库)
- 首页概览、时间线(筛选/编辑/删除)、统计(喂奶/体重 SVG 折线图/屎尿/血糖柱状图 + 妊娠期控糖阈值对比)
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
