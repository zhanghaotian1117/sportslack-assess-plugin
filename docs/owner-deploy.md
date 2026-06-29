# v4 管理员部署说明

这个仓库只给开发同事提交 v4 在线考试系统代码。Cloudflare 部署权限建议保留在管理员手里。

## 部署前检查

1. `wrangler.jsonc` 里的 Worker 名称必须是 `sportslack-assess`。
2. 路由必须是 `ai.sportslack.com/v4/assess/*`。
3. 必须保留 D1 绑定：`AUTH_DB -> sportslack-auth`。
4. 必须保留和中台一致的 `AUTH_SECRET`。
5. 如果有后端，设置 `ASSESS_BACKEND_ORIGIN`。
6. `frontend/dist/index.html` 必须存在。

## 第一次部署

如果机器上没有安装依赖：

```bash
npm ci
```

设置密钥：

```bash
npx wrangler secret put AUTH_SECRET
```

如果 v4 有后端：

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
