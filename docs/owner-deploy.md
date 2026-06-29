# v4 管理员部署说明

这个仓库只给开发同事提交 v4 在线考试系统代码。Cloudflare 部署权限建议保留在管理员手里。

## 部署前检查

1. `wrangler.jsonc` 里的 Worker 名称必须是 `sportslack-assess`。
2. 路由必须是 `ai.sportslack.com/v4/assess/*`。
3. v4 Worker 通过中台 `/api/auth/session` 校验登录，不需要单独配置 `AUTH_SECRET`。
4. 中台 Worker 必须已部署 v4 权限配置，账号管理里能看到 v4 在线考试系统。
5. 后端源码已随包放在 `backend/`，由管理员部署后设置 `ASSESS_BACKEND_ORIGIN`。
6. `frontend/dist/index.html` 必须存在。

## 第一次部署

如果机器上没有安装依赖：

```bash
npm ci
```

后端源码包位置：

```text
backend/
```

部署后把后端服务地址写入 Worker 变量：

```bash
npx wrangler secret put ASSESS_BACKEND_ORIGIN
```

部署：

```bash
npm run deploy
```

或者：

```bash
./scripts/deploy.sh
```

## 验证地址

```text
https://ai.sportslack.com/v4/assess/api/health
https://ai.sportslack.com/v4/assess/
```

未登录访问页面时应跳转到：

```text
https://ai.sportslack.com/login?next=/v4/assess/
```

登录后，需要账号拥有 v4 在线考试系统权限。
