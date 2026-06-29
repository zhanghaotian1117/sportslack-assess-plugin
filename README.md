# Sportslack v4 在线考试系统

这个仓库用于维护智能插件中台的 v4 在线考试系统。线上固定入口：

```text
https://ai.sportslack.com/v4/assess/
```

## 固定约定

- Worker 名称：`sportslack-assess`
- Cloudflare 路由：`ai.sportslack.com/v4/assess/*`
- 插件权限 key：`assess`
- 健康检查：`https://ai.sportslack.com/v4/assess/api/health`
- 前端静态输出目录：`frontend/dist`
- 后端代理变量：`ASSESS_BACKEND_ORIGIN`

## 目录说明

- `src/worker.js`：Cloudflare Worker，负责路由、登录校验、权限校验、静态资源和后端代理。
- `frontend/dist/`：前端构建输出目录。现在放了占位页，正式开发后用真实构建产物替换。
- `docs/upload-guide.md`：给开发同事的上传说明。
- `docs/owner-deploy.md`：管理员部署说明。
- `scripts/deploy.sh`：管理员部署脚本。
- `scripts/verify.sh`：上线后检查脚本。

## 同事开发流程

1. 把在线考试系统前端构建结果放到 `frontend/dist`。
2. 如果有后端服务，确保接口能被 Worker 通过 `ASSESS_BACKEND_ORIGIN` 访问。
3. 前端请求接口时使用相对路径，例如 `/v4/assess/api/exams` 或 `./api/exams`。
4. 不要修改 `wrangler.jsonc` 里的 Worker 名称、路由、D1 绑定。
5. 提交 Pull Request，由管理员审核后部署。

## 权限能力

中台会给账号分配 v4 插件权限。当前默认能力：

```json
["view", "take", "grade", "manage"]
```

Worker 当前按请求粗略映射能力：

- 页面访问：`view`
- 考试、题目读取接口：`take`
- 成绩、报告接口：`grade`
- 管理、导入、非 GET 请求：`manage`

后续如果考试系统需要更细权限，可以在 `src/worker.js` 的 `abilityForAssess` 中继续细分。
