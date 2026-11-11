# Chicken i Kimchi：GitHub + Cloudflare 网页部署

本版本使用 GitHub Actions 在云端运行 Wrangler。你不需要在 Mac 上安装 Node.js，也不需要在本地打开终端。Cloudflare D1、密钥和 GitHub 配置均通过网页完成。

## 1. 上传项目到 GitHub
1. 在 github.com 创建一个 **Private** 仓库（例如 `chicken-kds`），不要勾选自动生成 README。
2. 解压本 ZIP。打开 GitHub 仓库 → **Add file → Upload files**，上传解压目录中的所有文件，**尤其是 `.github/workflows/deploy.yml`**。注意：有些浏览器上传隐藏文件夹不方便，必要时在 GitHub 网页通过 **Add file → Create new file** 输入路径 `.github/workflows/deploy.yml` 并复制压缩包中该文件内容。
3. Commit 到 `main`。首次上传会触发 workflow，但此时未配置密钥，失败属于正常情况。

## 2. Cloudflare 创建 D1
Cloudflare Dashboard → Storage & databases → D1 → Create database。**数据库名必须是 `chicken_kds`**。复制创建后显示的 Database ID。
在 GitHub 打开 `wrangler.toml` → 编辑，将 `REPLACE_WITH_D1_DATABASE_ID` 替换成真实 Database ID，Commit。

## 3. Cloudflare API Token
Cloudflare → My Profile → API Tokens → Create Token。使用适合 Workers 部署的模板，并为 D1 增加所需权限（Workers Scripts: Edit、D1: Edit；按界面提示配置账户权限）。只授权你的 Cloudflare 账户，妥善保管 Token。复制 Cloudflare Account ID（Dashboard 的账户信息页面）。

## 4. GitHub Actions Secrets
GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：
- `CLOUDFLARE_API_TOKEN`：上一步 Token
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID

不要把 Token、PIN、AUTH_SECRET 写进 GitHub 源码。

## 5. 网页触发部署
GitHub 仓库 → Actions → **Deploy Chicken KDS to Cloudflare** → Run workflow → Run workflow。
Workflow 自动执行：安装依赖 → 初始化 D1 表 → 发布 Worker + 前端资源。
成功后在 Cloudflare → Workers & Pages 找到 `chicken-kds`，取得 `workers.dev` 地址。

## 6. Cloudflare 配置运行密钥
Cloudflare → Workers & Pages → `chicken-kds` → Settings → Variables and Secrets（界面名称可能略有差异），添加以下 **Secret**：
- `AUTH_SECRET`：至少 32 位随机字符串
- `POS_PIN`：前厅登录密码
- `KITCHEN_PIN`：厨房登录密码
- `ADMIN_PIN`：老板登录密码
- `SCANNER_PIN`：扫描器预留密码

每个角色使用不同的强密码。设置完后按 Cloudflare 提示部署新版本/重启配置。

## 7. 测试
- `https://你的域名/pos`：前厅
- `https://你的域名/kitchen`：厨房
- `https://你的域名/admin`：老板
- `https://你的域名/scanner`：预留页（**尚无 OCR 功能**）
先在 admin 增加测试菜品，再打开 pos 和 kitchen；厨房点击启用声音。下单、开始制作、完成出餐，并从手机打开 admin 验证同步。

## 当前限制
- Google Sheets / Apps Script **尚未接入**，只是预留 `sync_outbox` 数据表。不要误以为已经自动同步。
- Scanner 只是占位页面，不支持拍照识别。
- 当前 PIN 认证是原型级别，尚无登录限速、单人账户及安全审计，不宜未经加固直接正式营业。
- 生产上线前必须测试断网、重连、订单去重、iPad 锁屏声音限制、后台同步等。
- 这是 GitHub 网页操作 + 云端自动构建，不是 Cloudflare 控制台直接上传 ZIP。GitHub Actions 的构建仍会运行命令，但不需要你在本地运行。
