const MOUNT_PATH = "/v4/assess";
const PLUGIN_KEY = "assess";
const CANONICAL_HOST = "ai.sportslack.com";
const BACKEND_RETRY_DELAYS_MS = [250, 750, 1500];
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>在线考试系统</title>
    <script type="module" crossorigin src="/v4/assess/assets/index-v4-stability-20260630.js"></script>
    <link rel="stylesheet" crossorigin href="/v4/assess/assets/index-BhCOYPkP.css">
  </head>
  <body class="min-h-screen bg-background font-sans antialiased">
    <div id="root"></div>
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

function assessRoleForSession(session) {
  return session?.role === "admin" ? "admin" : "candidate";
}

function assessUserForSession(session) {
  if (!session?.sub) return null;
  return {
    username: session.sub,
    name: session.name || session.sub,
    role: session.role || "user",
    assessRole: assessRoleForSession(session),
    isAdmin: session.role === "admin",
    plugins: session.plugins || [],
    abilities: session.abilities || {},
  };
}

function assessUserForCenterUser(user) {
  if (!user?.username) return null;
  return {
    username: user.username,
    name: user.name || user.username,
    role: user.role || "user",
    assessRole: user.role === "admin" ? "admin" : "candidate",
    isAdmin: user.role === "admin",
    plugins: Array.isArray(user.plugins) ? user.plugins : [],
    abilities: user.abilities || {},
  };
}

function redirectToLogin(request) {
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  return Response.redirect(`https://${CANONICAL_HOST}/login?next=` + encodeURIComponent(next), 302);
}

function redirectToCanonicalHost(url) {
  if (url.hostname === CANONICAL_HOST) return null;
  if (url.hostname !== "sportslack.com" && url.hostname !== "www.sportslack.com") return null;
  const canonical = new URL(url.toString());
  canonical.protocol = "https:";
  canonical.hostname = CANONICAL_HOST;
  return Response.redirect(canonical.toString(), 301);
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
  if (!session) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(`${MOUNT_PATH}/api/`)) {
      return {
        response: Response.json(
          { error: "登录已过期，请重新登录" },
          { status: 401, headers: { "cache-control": "no-store" } },
        ),
        session: null,
      };
    }
    return { response: redirectToLogin(request), session: null };
  }
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

function isStaticAssetPath(pathname) {
  return pathname.startsWith(`${MOUNT_PATH}/`)
    && !pathname.startsWith(`${MOUNT_PATH}/api/`)
    && /\.[a-zA-Z0-9]+$/.test(pathname);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryBackend(method, response) {
  return ["GET", "HEAD"].includes(method)
    && [502, 503, 504].includes(response.status);
}

function backendUnavailableResponse() {
  return json(
    { error: "后端连接短暂中断，请稍后重试。" },
    { status: 503 },
  );
}

function serveIndexHtml() {
  return new Response(INDEX_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function fetchCenter(request, env, path, options = {}) {
  const url = new URL(request.url);
  const target = new URL(path, url.origin);
  const method = options.method || request.method;
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json");
  for (const [key, value] of Object.entries(options.headers || {})) {
    headers.set(key, value);
  }

  const init = {
    method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(method)) {
    init.body = options.body === undefined ? request.body : options.body;
  }

  const centerRequest = new Request(target.toString(), init);
  return env.PLUGIN_CENTER?.fetch
    ? env.PLUGIN_CENTER.fetch(centerRequest)
    : fetch(centerRequest);
}

async function centerJsonResponse(response, transform = null) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  headers.delete("content-encoding");
  const data = await response.json().catch(() => null);
  const body = transform ? transform(data) : data;
  return new Response(JSON.stringify(body || {}), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleAuthCompatibility(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === `${MOUNT_PATH}/api/auth/login`) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }
    const response = await fetchCenter(request, env, "/api/auth/login");
    return centerJsonResponse(response, (data) => ({
      ...(data || {}),
      token: data?.ok ? "sportslack-center-session" : undefined,
      user: assessUserForCenterUser(data?.user) || data?.user,
    }));
  }

  if (path === `${MOUNT_PATH}/api/auth/logout`) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }
    return fetchCenter(request, env, "/api/auth/logout");
  }

  if (path === `${MOUNT_PATH}/api/auth/me` || path === `${MOUNT_PATH}/api/auth/session`) {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }
    const session = await currentSession(request, env);
    if (!session) return json({ error: "登录已过期，请重新登录" }, { status: 401 });
    const user = assessUserForSession(session);
    return path.endsWith("/session") ? json({ ok: true, user }) : json(user);
  }

  if (path === `${MOUNT_PATH}/api/auth/password`) {
    return json(
      { error: "账号和密码已统一由智能插件中台管理。" },
      { status: 410 },
    );
  }

  return null;
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
  headers.set("x-sportslack-assess-role", assessRoleForSession(session));
  headers.set("x-sportslack-is-admin", session?.role === "admin" ? "true" : "false");
  headers.set("x-sportslack-plugins", JSON.stringify(session?.plugins || []));
  headers.set("x-sportslack-abilities", JSON.stringify(session?.abilities || {}));

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

  let response;
  let retried = false;
  const maxAttempts = ["GET", "HEAD"].includes(request.method)
    ? BACKEND_RETRY_DELAYS_MS.length + 1
    : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      response = await fetch(new Request(target.toString(), init));
      if (!shouldRetryBackend(request.method, response) || attempt === maxAttempts - 1) break;
    } catch {
      if (attempt === maxAttempts - 1) return backendUnavailableResponse();
    }
    retried = true;
    await sleep(BACKEND_RETRY_DELAYS_MS[attempt] || 0);
  }

  if (!response) return backendUnavailableResponse();
  if (shouldRetryBackend(request.method, response)) return backendUnavailableResponse();

  const nextHeaders = new Headers(response.headers);
  const contentType = nextHeaders.get("content-type") || "";
  if (contentType.includes("text/html")) nextHeaders.set("cache-control", "no-store");
  if (retried) nextHeaders.set("x-sportslack-backend-retry", "1");
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
  const looksLikeHtmlRoute = accept.includes("text/html") && !/\.[^/]+$/.test(assetUrl.pathname);
  if (looksLikeHtmlRoute) {
    return serveIndexHtml();
  }

  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
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
    const canonicalRedirect = redirectToCanonicalHost(url);
    if (canonicalRedirect) return canonicalRedirect;

    if (url.pathname === MOUNT_PATH) {
      const next = new URL(url);
      next.pathname = `${MOUNT_PATH}/`;
      return Response.redirect(next.toString(), 302);
    }

    if (url.pathname === `${MOUNT_PATH}/login` || url.pathname.startsWith(`${MOUNT_PATH}/login/`)) {
      const login = new URL("/login", url.origin);
      login.searchParams.set("next", `${MOUNT_PATH}/`);
      return Response.redirect(login.toString(), 302);
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

    const authCompatibility = await handleAuthCompatibility(request, env);
    if (authCompatibility) return authCompatibility;

    if (url.pathname === `${MOUNT_PATH}/` || url.pathname.startsWith(`${MOUNT_PATH}/`)) {
      if (isStaticAssetPath(url.pathname)) {
        return serveAsset(request, env);
      }

      const gate = await requirePlugin(request, env, PLUGIN_KEY, abilityForAssess(url.pathname, request.method));
      if (gate.response) return gate.response;

      if (url.pathname.startsWith(`${MOUNT_PATH}/api/`)) {
        if (url.pathname === `${MOUNT_PATH}/api/auth/session`) {
          return json({ ok: true, user: assessUserForSession(gate.session) });
        }
        if (url.pathname === `${MOUNT_PATH}/api/users` || url.pathname.startsWith(`${MOUNT_PATH}/api/users/`)) {
          return json(
            { error: "v4 用户管理已并入智能插件中台。" },
            { status: 410 },
          );
        }
        return proxyToBackend(request, env, gate.session);
      }

      if (!isStaticAssetPath(url.pathname)) {
        return serveIndexHtml();
      }

      return serveAsset(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
