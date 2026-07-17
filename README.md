# 智能记账 / 房东收租管理系统 开源版

Flask 全栈一体化（后端 + 前端静态文件一键启动，无需前后端分离部署）

## ✨ 功能一览

- 🔐 用户注册 / 登录（JWT 鉴权，支持 6 位数字账号）
- 📊 数据看板 / 总览（总收入、支出、净利润、本月收租进度）
- 💰 收支记账（收入/支出分类、图片凭证、筛选、分页、批量删除、Excel/CSV 导出）
- 🏠 收租提醒（到期日期、续租 30 天 / 1 年、批量删除、批量管理）
- 📈 多维度报表统计（按月、按分类、按用户画像）
- 🛡️ 管理中心（管理员 / 普通用户角色、用户软删除、二次验证密码、公告管理）
- ⚙️ 个人设置（昵称、头像、修改密码、导入导出）
- 📱 电脑端 + 手机端浏览器 100% 通用（JWT + 共享 DB，跨端账号互通，数据实时同步）

---

## 🚀 方式一：Windows 双击一键启动（推荐零配置）

1. 先装好 **Python 3.9+**（勾选 Add Python to PATH）
2. 双击仓库根目录的 **`start.bat`**
3. 脚本会自动：
   - ✅ 创建虚拟环境（.venv）并安装 requirements.txt 所有依赖（首次）
   - ✅ 若缺失 `.env`，自动从 `.env.example` 复制，并自动用 CSPRNG 生成 64 字符高熵 JWT 密钥
   - ✅ 自动初始化数据库（建表 + 默认管理员 + 分类种子数据）
   - ✅ 启动 Flask 服务（端口 5000，全网卡监听）
   - ✅ 自动打开浏览器 http://127.0.0.1:5000
4. 开始使用！

## 🚀 方式二：命令行启动

```bash
# 1. 进入后端目录
cd backend

# 2. 装依赖（第一次）
pip install -r requirements.txt

# 3. 复制配置模板（第一次）
copy .env.example .env
# Windows CMD 用上面；PowerShell 用：Copy-Item .env.example .env
# （JWT_SECRET 不用手动改，首次启动会自动生成高熵密钥写进 .env）

# 4. 启动服务
python app.py
```

启动后浏览器访问：**http://127.0.0.1:5000**

---

## 🔑 默认测试账号（首次启动时自动创建）

| 角色 | 账号 | 密码 | 说明 |
|---|---|---|---|
| 👑 超级管理员 | `100000` | `123456` | 登录后可进入管理中心 |
| 🧑 普通用户 Demo | `123456` | `123456` | 生产可在 `.env` 里设 `DISABLE_DEMO_USER=1` 关闭 |

> ⚠️ **生产部署强烈建议**：
> 1. 修改 `.env` 里的 `ADMIN_PASSWORD` 为你自己的强密码
> 2. 设 `DISABLE_DEMO_USER=1` 关闭 Demo 账号
> 3. 设 `CORS_ORIGINS` 为你的真实域名（不要留 `*`）

---

## 📁 目录结构

```
.
├── backend/                # Flask 后端（Python）
│   ├── app.py              # 入口 + 一体化前端静态文件托管
│   ├── config.py           # 配置（JWT / DB 路径 / CORS / 安全开关）
│   ├── init_db.py          # 数据库初始化（首次启动自动执行）
│   ├── requirements.txt    # Python 依赖
│   ├── .env.example        # 环境变量模板（首次使用复制为 .env）
│   ├── data/               # SQLite 数据库文件（运行时生成 app.db）
│   ├── db/                 # DB 适配层（SQLite）
│   ├── routes/             # API 路由：auth/admin/dashboard/transactions/reminders/stats/io
│   ├── services/           # 业务服务层：认证/账单/收租提醒/统计/导入导出
│   └── utils/              # 装饰器（JWT 登录/管理员）、验证码、参数校验
└── frontend/               # 前端（纯静态，Flask 托管）
    ├── index.html          # 单页应用入口
    ├── manifest.json       # PWA 配置
    ├── css/style.css       # 样式
    ├── images/             # 登录背景图 / APP 图标
    ├── icons/              # PWA 各尺寸图标
    └── js/                 # 业务 JS：登录/看板/API封装/路由 + modules(管理/账单/收租/报表/设置/统计)
```

---

## 🐳 生产部署建议

- **后端进程守护**：Windows 用 nssm / AlwaysUp 把 `python backend/app.py` 注册为系统服务；Linux 用 supervisor / systemd + gunicorn
- **HTTP 反向代理**：Nginx 托管静态 + 反代 5000，HTTPS 证书
- **数据备份**：每月在系统设置里点「报表导出」导出数据，或直接备份 `backend/data/app.db`
- **安全**：.env 权限设为仅管理员读写，不要提交真实 .env 到 Git

---

## 📜 License

随仓库文件 `LICENSE` 所示。
