# v4 在线考试系统上传指南

这份说明给负责 v4 在线考试系统的开发同事使用。

## 线上入口

```text
https://ai.sportslack.com/v4/assess/
```

## 你需要提交什么

推荐提交完整项目源码，同时保证管理员可以构建出静态文件：

```text
frontend/dist
```

如果你的项目已经有自己的目录结构，也可以保留，例如：

```text
frontend/
  package.json
  src/
  dist/
```

管理员部署时只会把 `frontend/dist` 作为线上静态目录。

## 构建要求

请保证本地执行构建后，产物在：

```text
frontend/dist
```

如果是 Vite / React / Vue，常见配置为：

```text
Root directory: frontend
Build command: npm ci && npm run build
Output directory: dist
```

## 接口请求规则

前端不要写死域名。请用相对路径：

```js
fetch("./api/exams")
fetch("/v4/assess/api/exams")
```

Worker 会把 `/v4/assess/api/*` 转发到后端 `ASSESS_BACKEND_ORIGIN`。

## 后端服务

如果 v4 有独立后端，请提供给管理员：

```text
ASSESS_BACKEND_ORIGIN=https://你的后端域名
```

后端收到请求时，会带这些转发头：

```text
x-forwarded-host: ai.sportslack.com
x-forwarded-proto: https
x-forwarded-prefix: /v4/assess
x-sportslack-plugin: assess
```

后端如果生成链接，请考虑 `/v4/assess` 前缀。

## 不能改的内容

- 不要改 Worker 名称：`sportslack-assess`
- 不要改线上路由：`ai.sportslack.com/v4/assess/*`
- 不要删除 `AUTH_DB` 绑定
- 不要删除 `AUTH_SECRET` 鉴权逻辑
- 不要绕过中台登录和账号权限
- 不要把密钥写进代码或文档

## 上线前自查

- [ ] `frontend/dist/index.html` 存在
- [ ] 静态资源路径在 `/v4/assess/` 下可以正常加载
- [ ] API 使用相对路径，没有写死 localhost
- [ ] 后端接口可以被公网或 Cloudflare Worker 访问
- [ ] 健康检查 `/v4/assess/api/health` 正常
- [ ] 普通用户没有 v4 权限时不能访问
- [ ] 分配 v4 权限后可以访问
