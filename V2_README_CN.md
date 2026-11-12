# Chicken i Kimchi V2.0 第一阶段（基础版）

## 本包内容
- 英语登录、前厅、后厨、后台界面基础翻译
- 菜品图片显示（菜单记录有 image_url 时显示）
- 后厨直接点击整道菜标记完成；再次点击撤销
- D1 数据库迁移，为图片、VAT、Modifiers、Payments 提前建表

## 部署顺序（重要）
1. 备份生产 D1 数据库。
2. 先执行 migrations/0002_v2_foundation.sql（仅执行一次）。
3. 再上传并部署 src/index.js、public/app.js、public/style.css 及其余项目文件。
4. 测试 POS 下单、KDS 点菜完成、再次点击撤销、WebSocket 同步。

## 现阶段未实现
Modifiers 的编辑与选择、VAT 结账计算、Open Tickets 完整编辑、收银和 Receipts。数据库已预留部分基础表，但不能当作这些功能已完成。

## 数据库迁移命令
使用已配置 wrangler 的本地终端：
`npx wrangler d1 execute chicken_kds --remote --file=migrations/0002_v2_foundation.sql`
执行前务必备份；已运行过迁移不可重复运行 ALTER TABLE。
