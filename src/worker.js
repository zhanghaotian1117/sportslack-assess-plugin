const SESSION_COOKIE = "sl_auth";
const MOUNT_PATH = "/v4/assess";
const PLUGIN_KEY = "assess";

function parseCookies(header = "") {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeJson(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

function authSecret(env) {
  const secret = String(env.AUTH_SECRET || "").trim();
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return secret;
}

async function verifySessionToken(token, env) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = await hmac(authSecret(env), body);
  if (sig !== expected) return null;
  const payload = decodeJson(body);
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function currentSession(request, env) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  try {
    const session = await verifySessionToken(cookies[SESSION_COOKIE], env);
    if (!session) return null;
    if (env.AUTH_DB) {
      const account = await env.AUTH_DB.prepare("SELECT username, status, session_version FROM users WHERE username = ?")
        .bind(String(session.sub || "").toLowerCase())
        .first();
      if (!account || account.status !== "active") return null;
      if (Number(session.sessionVersion || 0) !== Number(account.session_version || 0)) return null;
    }
    return session;
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
  if (method !== "GET") return "manage";
  if (pathname.startsWith(`${MOUNT_PATH}/api/admin`) || pathname.startsWith(`${MOUNT_PATH}/api/import`)) return "manage";
  if (pathname.startsWith(`${MOUNT_PATH}/api/result`) || pathname.startsWith(`${MOUNT_PATH}/api/report`)) return "grade";
  if (pathname.startsWith(`${MOUNT_PATH}/api/exam`) || pathname.startsWith(`${MOUNT_PATH}/api/question`)) return "take";
  return "view";
}

async function proxyToBackend(request, env) {
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
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") || "";
  if (contentType.includes("text/html")) headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
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
        return proxyToBackend(request, env);
      }

      return serveAsset(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
