# v4 在线考试系统后端

这是 Sportslack v4 在线考试系统的后端源码包，由我们部署到服务器后，再把服务地址配置到 Cloudflare Worker 的 `ASSESS_BACKEND_ORIGIN`。

## 技术栈

- Node.js 20+
- Express
- TypeScript / tsx
- SQLite / better-sqlite3

## 安装依赖

```bash
npm ci
```

## 启动

开发或直接运行 TypeScript：

```bash
npm start
```

默认监听：

```text
PORT=8000
```

健康检查：

```text
GET /api/health
```

## 数据库

后端使用 SQLite，数据库文件默认放在后端目录：

```text
backend/exam.db
```

启动时如果 `exam.db` 不存在，服务会拒绝创建空库，避免误清空正式数据。部署时请先把正式数据库文件放到 `backend/exam.db`。

服务启动会执行安全迁移：

- 只创建缺失表
- 只补充缺失字段
- 不清空已有数据
- 启动前后自动生成数据库备份
- 所有写接口执行前自动生成数据库备份

备份目录：

```text
backend/backups/
```

不要提交或公开以下文件：

```text
exam.db
exam.db-wal
exam.db-shm
backups/
.password-vault-key
```

## Sportslack 身份协议

线上请求路径：

```text
https://ai.sportslack.com/v4/assess/api/*
```

Cloudflare Worker 会先校验中台登录和 `assess` 插件权限，再把请求转发到本后端。后端收到的路径是：

```text
/api/*
```

后端不需要自己的登录 cookie。线上身份来自 Worker 透传的请求头：

```text
x-sportslack-user
x-sportslack-role
x-sportslack-assess-role
x-sportslack-is-admin
x-sportslack-plugins
x-sportslack-abilities
x-sportslack-plugin
x-forwarded-prefix
```

角色映射：

```text
x-sportslack-assess-role=admin     -> v4 平台管理员
x-sportslack-assess-role=candidate -> v4 考生账号
```

本后端已兼容上述请求头；没有这些请求头时，才回退到本地开发用 JWT。

## 文件上传和题库导入

当前系统的题目图片和考生简答题图片以压缩后的 data URL 存入 SQLite 结果或题目字段。题库导入、导出走 JSON/HTML 接口，不依赖额外对象存储。

## 环境变量

参考 `.env.example`。
