const MOUNT_PATH = "/v4/assess";
const PLUGIN_KEY = "assess";
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>v4 在线考试系统 | Sportslack</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <p>Sportslack v4</p>
          <h1>在线考试系统</h1>
        </div>
        <a href="/" class="center-link">返回智能插件中台</a>
      </header>
      <section class="hero">
        <div class="copy">
          <span class="eyebrow">ASSESSMENT WORKBENCH</span>
          <h2>v4 路由和权限已经预留完成。</h2>
          <p>
            同事上传正式考试系统代码后，请将前端构建产物输出到
            <code>frontend/dist</code>，线上入口保持
            <code>https://ai.sportslack.com/v4/assess/</code>。
          </p>
          <div class="actions">
            <a href="./api/health">查看健康检查</a>
          </div>
        </div>
        <div class="panel" aria-hidden="true">
          <div class="screen-line"></div>
          <div class="screen-grid">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="score-ring">AI</div>
        </div>
      </section>
    </main>
  </body>
</html>
`;

async function currentSession(request, env) {
  const url = new URL(request.url);
  const sessionUrl = new URL("/api/auth/session", url.origin);
  try {
    const sessionRequest = new Request(sessionUrl.toString(), {
      headers: {
        cookie: request.headers.get("cookie") || "",
        accept: "application/json",
      },
    });
    const response = env.PLUGIN_CENTER?.fetch
      ? await env.PLUGIN_CENTER.fetch(sessionRequest)
      : await fetch(sessionRequest);
    if (!response.ok) return null;
    const data = await response.json();
    const user = data?.user;
    if (!user?.username) return null;
    return {
      sub: user.username,
      name: user.name || user.username,
      role: user.role || "user",
      plugins: Array.isArray(user.plugins) ? user.plugins : [],
      abilities: user.abilities || {},
      sessionVersion: user.sessionVersion || 0,
      expiresAt: user.expiresAt,
    };
  } catch {
    return null;
  }
}

function hasPlugin(session, plugin) {
  return Boolean(session?.plugins?.includes(plugin));
}

function hasAbility(session, plugin, ability) {
  if (!ability) return true;
  return Boolean(session?.abilities?.[plugin]?.includes(ability));
}

function redirectToLogin(request) {
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  return Response.redirect(url.origin + "/login?next=" + encodeURIComponent(next), 302);
}

function forbidden(message = "当前账号没有权限访问此功能。") {
  return new Response(message, {
    status: 403,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function requirePlugin(request, env, plugin, ability = null) {
  const session = await currentSession(request, env);
  if (!session) return { response: redirectToLogin(request), session: null };
  if (!hasPlugin(session, plugin) || !hasAbility(session, plugin, ability)) {
    return { response: forbidden(), session };
  }
  return { session };
}

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function backendBaseUrl(env) {
  return String(env.ASSESS_BACKEND_ORIGIN || "").trim().replace(/\/+$/, "");
}

function stripMountPath(pathname) {
  const suffix = pathname.slice(MOUNT_PATH.length);
  return suffix || "/";
}

function abilityForAssess(pathname, method) {
  const apiPath = pathname.startsWith(`${MOUNT_PATH}/api`)
    ? pathname.slice(`${MOUNT_PATH}/api`.length) || "/"
    : pathname;

  if (method !== "GET") {
    if (method === "POST" && apiPath === "/questions/batch") return "take";
    if (apiPath.startsWith("/results") || apiPath.startsWith("/reexam")) return "take";
    if (apiPath.startsWith("/exam-approvals") && method === "POST") return "take";
    if (apiPath.startsWith("/mistakes")) return "take";
    if (apiPath.startsWith("/gradings") || apiPath.startsWith("/grading")) return "grade";
    return "manage";
  }

  if (apiPath.startsWith("/admin") || apiPath.startsWith("/users")) return "manage";
  if (apiPath.startsWith("/categories") || apiPath.startsWith("/tags")) return "manage";
  if (apiPath.startsWith("/questions/export") || apiPath.startsWith("/questions/import")) return "manage";
  if (apiPath.startsWith("/results") || apiPath.startsWith("/report")) return "grade";
  if (apiPath.startsWith("/gradings") || apiPath.startsWith("/grading")) return "grade";
  if (apiPath.startsWith("/exam") || apiPath.startsWith("/question")) return "take";
  if (apiPath.startsWith("/practice") || apiPath.startsWith("/mistakes")) return "take";
  return "view";
}

async function proxyToBackend(request, env, session) {
  const baseUrl = backendBaseUrl(env);
  if (!baseUrl) {
    return json(
      {
        ok: false,
        error: "ASSESS_BACKEND_ORIGIN is not configured.",
        hint: "Set ASSESS_BACKEND_ORIGIN when v4 has a backend service.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const backendPath = stripMountPath(url.pathname);
  const target = new URL(backendPath, `${baseUrl}/`);
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  headers.set("x-forwarded-prefix", MOUNT_PATH);
  headers.set("x-sportslack-plugin", PLUGIN_KEY);
  headers.set("x-sportslack-user", String(session?.sub || ""));
  headers.set("x-sportslack-role", String(session?.role || "user"));
  headers.set("x-sportslack-plugins", JSON.stringify(session?.plugins || []));
  headers.set("x-sportslack-abilities", JSON.stringify(session?.abilities || {}));

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

  const response = await fetch(new Request(target.toString(), init));
  const nextHeaders = new Headers(response.headers);
  const contentType = nextHeaders.get("content-type") || "";
  if (contentType.includes("text/html")) nextHeaders.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}

async function serveAsset(request, env) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const requestUrl = new URL(request.url);
  const assetUrl = new URL(request.url);
  assetUrl.pathname = stripMountPath(requestUrl.pathname);
  const accept = request.headers.get("accept") || "";
  const strippedPath = assetUrl.pathname;
  const looksLikeHtmlRoute = accept.includes("text/html") && !/\.[^/]+$/.test(strippedPath);
  if (looksLikeHtmlRoute) {
    return new Response(INDEX_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  const response = looksLikeHtmlRoute
    ? await env.ASSETS.fetch(new Request(new URL("/index.html", assetUrl.origin).toString(), request))
    : await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  const finalResponse = response.status === 404 && accept.includes("text/html")
    ? await env.ASSETS.fetch(new Request(new URL("/index.html", assetUrl.origin).toString(), request))
    : response;

  const headers = new Headers(finalResponse.headers);
  const contentType = headers.get("content-type") || "";
  if (contentType.includes("text/html")) headers.set("cache-control", "no-store");
  return new Response(finalResponse.body, {
    status: finalResponse.status,
    statusText: finalResponse.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === MOUNT_PATH) {
      const next = new URL(url);
      next.pathname = `${MOUNT_PATH}/`;
      return Response.redirect(next.toString(), 302);
    }

    if (url.pathname === `${MOUNT_PATH}/api/health`) {
      return json({
        ok: true,
        plugin: PLUGIN_KEY,
        worker: "sportslack-assess",
        path: `${MOUNT_PATH}/`,
        backendConfigured: Boolean(backendBaseUrl(env)),
        checkedAt: new Date().toISOString(),
      });
    }

    if (url.pathname === `${MOUNT_PATH}/` || url.pathname.startsWith(`${MOUNT_PATH}/`)) {
      const gate = await requirePlugin(request, env, PLUGIN_KEY, abilityForAssess(url.pathname, request.method));
      if (gate.response) return gate.response;

      if (url.pathname.startsWith(`${MOUNT_PATH}/api/`)) {
        if (url.pathname === `${MOUNT_PATH}/api/auth/session`) {
          return json({
            ok: true,
            user: {
              username: gate.session?.sub,
              name: gate.session?.name,
              role: gate.session?.role || "user",
              plugins: gate.session?.plugins || [],
              abilities: gate.session?.abilities || {},
            },
          });
        }
        return proxyToBackend(request, env, gate.session);
      }

      return serveAsset(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
