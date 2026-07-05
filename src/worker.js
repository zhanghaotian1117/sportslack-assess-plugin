const MOUNT_PATH = "/v4/assess";
const PLUGIN_KEY = "assess";
const CANONICAL_HOST = "ai.sportslack.com";
const PLUGIN_CHROME = {
  key: PLUGIN_KEY,
  name: "在线考试",
  section: "培训考核",
  healthPath: `${MOUNT_PATH}/api/health`,
};
const BACKEND_RETRY_DELAYS_MS = [300, 900, 1800];
const BACKEND_TRANSIENT_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
const BACKEND_PROXY_TIMEOUT_MS = 12000;
const CACHEABLE_BACKEND_GET_PATHS = new Set([
  "/questions",
  "/categories",
  "/tags",
  "/exams",
]);
const BACKEND_CACHE_TTL_SECONDS = 600;
const BACKEND_CACHE_STALE_SECONDS = 24 * 60 * 60;
const ASSESS_STUDENT_ABILITIES = new Set(["view", "take", "student"]);
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
  const abilities = session?.abilities?.[plugin];
  if (Array.isArray(abilities) && (abilities.includes(ability) || abilities.includes("access"))) {
    return true;
  }

  if (plugin === PLUGIN_KEY && hasPlugin(session, plugin)) {
    if (session?.role === "admin") return true;
    return ASSESS_STUDENT_ABILITIES.has(ability);
  }

  return false;
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
    && BACKEND_TRANSIENT_STATUS.has(response.status);
}

function backendApiPath(pathname) {
  const apiPath = pathname.startsWith(`${MOUNT_PATH}/api`)
    ? pathname.slice(`${MOUNT_PATH}/api`.length) || "/"
    : pathname;
  return apiPath.replace(/\/+$/, "") || "/";
}

function isCacheableBackendGet(request, pathname) {
  if (request.method !== "GET") return false;
  const apiPath = backendApiPath(pathname);
  if (CACHEABLE_BACKEND_GET_PATHS.has(apiPath)) return true;
  return apiPath.startsWith("/questions/category/");
}

function backendCacheKey(request, session) {
  const url = new URL(request.url);
  url.searchParams.sort();
  url.searchParams.set("__sportslack_cache_role", session?.role || "user");
  return new Request(`${url.origin}${url.pathname}${url.search}`);
}

function cachedResponse(cached, retried = false) {
  const headers = new Headers(cached.headers);
  headers.set("x-sportslack-backend-cache", "HIT");
  headers.set("cache-control", "no-store");
  if (retried) headers.set("x-sportslack-backend-retry", "1");
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

function backendUnavailableResponse(retried = false) {
  return json(
    { error: "后端连接短暂中断，请稍后重试。" },
    {
      status: 503,
      headers: retried ? { "x-sportslack-backend-retry": "1" } : {},
    },
  );
}

async function fetchWithTimeout(request, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new Request(request, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function checkBackendHealth(env) {
  const baseUrl = backendBaseUrl(env);
  if (!baseUrl) {
    return { configured: false, ok: false, error: "ASSESS_BACKEND_ORIGIN is not configured." };
  }

  const started = Date.now();
  try {
    const target = new URL("/api/health", `${baseUrl}/`);
    const response = await fetchWithTimeout(new Request(target.toString(), {
      headers: { accept: "application/json" },
    }), 6500);
    const data = await response.json().catch(() => ({}));
    return {
      configured: true,
      ok: response.ok && data.ok !== false,
      status: response.status,
      responseTimeMs: Date.now() - started,
      data,
    };
  } catch {
    return {
      configured: true,
      ok: false,
      responseTimeMs: Date.now() - started,
      error: "后端连接超时",
    };
  }
}

function serveIndexHtml(session = null) {
  return new Response(injectPluginChromeHtml(INDEX_HTML, session), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function pluginChromeSnippet(meta, session) {
  const user = escapeHtml(session?.name || session?.sub || "当前账号");
  const name = escapeHtml(meta.name);
  const section = escapeHtml(meta.section);
  const healthPath = escapeHtml(meta.healthPath);
  return `<style>
    :root{--plugin-shell-height:58px}
    body{padding-top:0!important}
    .center-return-button,.center-back-link,a[aria-label="返回智能插件中台"],a[href="https://ai.sportslack.com/"]{display:none!important}
    .sportslack-plugin-shell{position:relative;z-index:50;min-height:var(--plugin-shell-height);display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 18px;background:rgba(247,251,255,.96);border-bottom:1px solid #d8e4f4;box-shadow:0 8px 22px rgba(20,42,75,.06);backdrop-filter:blur(16px);font-family:Inter,"Noto Sans SC",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#14213d}
    .sportslack-plugin-shell *{box-sizing:border-box}
    .sportslack-plugin-brand{min-width:0;display:flex;align-items:center;gap:11px}
    .sportslack-plugin-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;color:#fff;font-weight:900;background:linear-gradient(135deg,#246bfe,#04a7c9 58%,#16b892);box-shadow:0 10px 24px rgba(36,107,254,.22)}
    .sportslack-plugin-title{min-width:0;display:grid;gap:2px}
    .sportslack-plugin-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;line-height:1.2}
    .sportslack-plugin-title span{color:#65748b;font-size:12px;font-weight:800}
    .sportslack-plugin-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}
    .sportslack-plugin-chip,.sportslack-plugin-link,.sportslack-plugin-status{min-height:34px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;font-size:12px;font-weight:850;white-space:nowrap}
    .sportslack-plugin-chip{padding:0 10px;color:#28547c;background:#fff;border:1px solid #d1deef}
    .sportslack-plugin-health-wrap{position:relative;display:inline-flex}
    .sportslack-plugin-status{gap:6px;padding:0 10px;color:#087c63;background:rgba(22,184,146,.1);border:1px solid rgba(22,184,146,.22);cursor:pointer}
    .sportslack-plugin-status[data-status="offline"]{color:#a42136;background:rgba(230,57,94,.1);border-color:rgba(230,57,94,.22)}
    .sportslack-plugin-dot{width:7px;height:7px;border-radius:50%;background:currentColor}
    .sportslack-plugin-menu{position:absolute;right:0;top:calc(100% + 8px);min-width:132px;padding:6px;background:#fff;border:1px solid #d4e0f0;border-radius:8px;box-shadow:0 16px 36px rgba(18,35,62,.16);display:none;z-index:55}
    .sportslack-plugin-health-wrap.open .sportslack-plugin-menu{display:grid}
    .sportslack-plugin-logout{width:100%;min-height:34px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:#a42136;font-size:12px;font-weight:850;text-align:left;cursor:pointer}
    .sportslack-plugin-logout:hover{background:rgba(230,57,94,.08)}
    .sportslack-plugin-link{padding:0 12px;color:#fff;text-decoration:none;background:linear-gradient(135deg,#246bfe,#04a7c9);border:1px solid transparent}
    @media(max-width:760px){:root{--plugin-shell-height:92px}.sportslack-plugin-shell{align-items:flex-start;flex-direction:column;padding:10px 12px}.sportslack-plugin-actions{width:100%;justify-content:flex-start;overflow-x:auto}.sportslack-plugin-chip,.sportslack-plugin-link,.sportslack-plugin-status{min-height:30px}.sportslack-plugin-menu{right:auto;left:0}}
  </style><script>
    (function(){
      var meta={name:${JSON.stringify(name)},section:${JSON.stringify(section)},healthPath:${JSON.stringify(healthPath)},user:${JSON.stringify(user)}};
      function hideLegacyCenterLinks(){
        var items=document.querySelectorAll('a,button');
        for(var i=0;i<items.length;i++){
          var el=items[i];
          if(el.closest('.sportslack-plugin-shell'))continue;
          var text=(el.innerText||el.textContent||'').replace(/\s+/g,'').trim();
          var aria=(el.getAttribute('aria-label')||'').replace(/\s+/g,'').trim();
          var href=el.getAttribute('href')||'';
          var isLegacy=/^(‹|<)?返回(智能)?插件?中台$/.test(text)||aria.indexOf('返回智能插件中台')>=0||(href==='https://ai.sportslack.com/'&&text.indexOf('返回')>=0);
          if(isLegacy){el.style.display='none';el.setAttribute('data-plugin-hidden-center-return','true');}
        }
      }
      function logout(){fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).finally(function(){location.href='/login';});}
      function updateStatus(shell,ok){var el=shell.querySelector('[data-plugin-health-toggle]');el.dataset.status=ok?'online':'offline';el.innerHTML='<span class="sportslack-plugin-dot"></span>'+(ok?'在线':'异常');}
      function mount(){
        hideLegacyCenterLinks();
        if(document.querySelector('.sportslack-plugin-shell'))return;
        var shell=document.createElement('div');
        shell.className='sportslack-plugin-shell';
        shell.innerHTML='<div class="sportslack-plugin-brand"><div class="sportslack-plugin-mark">AI</div><div class="sportslack-plugin-title"><strong>'+meta.name+'</strong><span>'+meta.section+'</span></div></div><div class="sportslack-plugin-actions"><span class="sportslack-plugin-chip">'+meta.user+'</span><span class="sportslack-plugin-health-wrap"><button class="sportslack-plugin-status" data-plugin-health-toggle type="button" aria-haspopup="menu" aria-expanded="false"><span class="sportslack-plugin-dot"></span>检测中</button><span class="sportslack-plugin-menu" role="menu"><button class="sportslack-plugin-logout" data-plugin-logout type="button" role="menuitem">退出登录</button></span></span><a class="sportslack-plugin-link" href="/">返回中台</a></div>';
        document.body.prepend(shell);
        var wrap=shell.querySelector('.sportslack-plugin-health-wrap');
        var toggle=shell.querySelector('[data-plugin-health-toggle]');
        toggle.addEventListener('click',function(event){event.stopPropagation();var open=!wrap.classList.contains('open');wrap.classList.toggle('open',open);toggle.setAttribute('aria-expanded',open?'true':'false');});
        document.addEventListener('click',function(){wrap.classList.remove('open');toggle.setAttribute('aria-expanded','false');});
        shell.querySelector('[data-plugin-logout]').addEventListener('click',function(event){event.stopPropagation();logout();});
        fetch(meta.healthPath,{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json'}}).then(function(res){return res.json().then(function(data){return{ok:res.ok&&data.ok!==false&&data.backendOk!==false};});}).then(function(result){updateStatus(shell,result.ok);}).catch(function(){updateStatus(shell,false);});
        setTimeout(hideLegacyCenterLinks,0);
        if(window.MutationObserver){new MutationObserver(hideLegacyCenterLinks).observe(document.body,{childList:true,subtree:true});}
      }
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
    })();
  </script>`;
}

function injectPluginChromeHtml(html, session) {
  const snippet = pluginChromeSnippet(PLUGIN_CHROME, session);
  return html.includes("</head>") ? html.replace("</head>", `${snippet}</head>`) : `${snippet}${html}`;
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
  if (apiPath.startsWith("/categories") || apiPath.startsWith("/tags")) return "take";
  if (apiPath.startsWith("/questions/export") || apiPath.startsWith("/questions/import")) return "manage";
  if (apiPath.startsWith("/results")) return "take";
  if (apiPath.startsWith("/report")) return "grade";
  if (apiPath.startsWith("/gradings") || apiPath.startsWith("/grading")) return "grade";
  if (apiPath.startsWith("/exam") || apiPath.startsWith("/question")) return "take";
  if (apiPath.startsWith("/practice") || apiPath.startsWith("/mistakes")) return "take";
  return "view";
}

async function proxyToBackend(request, env, session, ctx) {
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
  const canUseCache = isCacheableBackendGet(request, url.pathname);
  const cache = canUseCache ? caches.default : null;
  const cacheKey = canUseCache ? backendCacheKey(request, session) : null;

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
      const backendRequest = new Request(target.toString(), init);
      response = ["GET", "HEAD"].includes(request.method)
        ? await fetchWithTimeout(backendRequest, BACKEND_PROXY_TIMEOUT_MS)
        : await fetch(backendRequest);
      if (!shouldRetryBackend(request.method, response) || attempt === maxAttempts - 1) break;
    } catch {
      if (attempt === maxAttempts - 1) {
        const cached = cache && cacheKey ? await cache.match(cacheKey) : null;
        if (cached) return cachedResponse(cached, retried);
        return backendUnavailableResponse(retried);
      }
    }
    retried = true;
    await sleep(BACKEND_RETRY_DELAYS_MS[attempt] || 0);
  }

  if (!response || shouldRetryBackend(request.method, response)) {
    const cached = cache && cacheKey ? await cache.match(cacheKey) : null;
    if (cached) return cachedResponse(cached, retried);
    return backendUnavailableResponse(retried);
  }

  const nextHeaders = new Headers(response.headers);
  const contentType = nextHeaders.get("content-type") || "";
  if (contentType.includes("text/html")) nextHeaders.set("cache-control", "no-store");
  if (retried) nextHeaders.set("x-sportslack-backend-retry", "1");

  const finalResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
  if (cache && cacheKey && finalResponse.ok) {
    const cacheHeaders = new Headers(finalResponse.headers);
    cacheHeaders.set("cache-control", `public, max-age=${BACKEND_CACHE_TTL_SECONDS}, stale-while-revalidate=${BACKEND_CACHE_STALE_SECONDS}`);
    cacheHeaders.set("x-sportslack-cache-stored-at", new Date().toISOString());
    cacheHeaders.delete("set-cookie");
    const cacheResponse = new Response(finalResponse.clone().body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers: cacheHeaders,
    });
    const store = cache.put(cacheKey, cacheResponse);
    if (ctx?.waitUntil) ctx.waitUntil(store);
    else await store;
  }
  return finalResponse;
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
  async fetch(request, env, ctx) {
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
      const backend = await checkBackendHealth(env);
      return json({
        ok: backend.configured ? backend.ok : true,
        plugin: PLUGIN_KEY,
        worker: "sportslack-assess",
        path: `${MOUNT_PATH}/`,
        backendConfigured: backend.configured,
        backendOk: backend.ok,
        backend,
        checkedAt: new Date().toISOString(),
      }, { status: backend.configured && !backend.ok ? 503 : 200 });
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
        return proxyToBackend(request, env, gate.session, ctx);
      }

      if (!isStaticAssetPath(url.pathname)) {
        return serveIndexHtml(gate.session);
      }

      return serveAsset(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
