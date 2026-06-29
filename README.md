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

- `src/worker.js`：Cloudflare Worker，负责路由、调用中台会话接口校验登录权限、静态资源和后端代理。
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

## v4 自带登录的改造要求

如果原在线考试系统已经有自己的登录页、管理员账号和普通账号，请按下面方式改造：

1. 不再展示 v4 自己的登录页，未登录统一跳转中台 `/login?next=/v4/assess/`。
2. 前端启动后调用 `/v4/assess/api/auth/session` 或业务后端自己的 session 接口获取当前用户。
3. 后端不要再校验 v4 自己的登录 cookie，改为信任 Worker 透传的用户身份头。
4. v4 里的管理员/普通用户角色可以继续保留，但来源要映射中台账号角色：
   - 中台 `role=admin` -> v4 管理员
   - 中台 `role=user` -> v4 普通账号
5. v4 如果有更细的考试权限，例如出题、组卷、判分、查看成绩，可以映射中台 abilities：
   - `view`：访问考试系统
   - `take`：参加考试、读取试题
   - `grade`：查看/处理成绩和报告
   - `manage`：题库、考试、用户、导入等管理操作

同事需要删除或旁路原系统的注册、登录、退出、改密入口。账号创建、删除、禁用、改密统一在智能插件中台的账号管理里完成。

## 线上鉴权方式

v4 Worker 不单独保存中台登录密钥。它会携带浏览器 cookie 调用同域中台接口：

```text
GET /api/auth/session
```

由中台返回当前账号、角色、插件权限和 abilities。这样新增 v4 Worker 时不需要额外同步 `AUTH_SECRET`，但必须保证中台 Worker 已部署并包含 v4 权限配置。
