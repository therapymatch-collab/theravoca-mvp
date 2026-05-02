import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

/**
 * Flatten a FastAPI 422 validation-error detail array into a single
 * human-readable string. FastAPI returns
 *   detail: [ { type, loc, msg, input, ctx, url }, ... ]
 * on Pydantic validation failures; if the frontend passes that array
 * directly into `toast.error(...)` or any JSX sink, React tries to
 * render the object and throws "Objects are not valid as a React
 * child". This helper normalises everything to a string so every
 * existing `toast.error(err?.response?.data?.detail || "fallback")`
 * callsite keeps working without being rewritten.
 */
function _normaliseDetail(detail) {
  if (detail == null) return detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // Pydantic v2 error list — show the first field + message, join
    // the rest with "; " so long forms surface every error concisely.
    const msgs = detail
      .map((d) => {
        if (!d || typeof d !== "object") return String(d);
        const loc = Array.isArray(d.loc)
          ? d.loc.filter((x) => x !== "body" && x !== "query").join(".")
          : "";
        const msg = d.msg || d.message || "";
        return loc && msg ? `${loc}: ${msg}` : msg || loc || JSON.stringify(d);
      })
      .filter(Boolean);
    return msgs.join("; ") || "Request validation failed";
  }
  if (typeof detail === "object") {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail);
}

/**
 * Install a response interceptor that runs `_normaliseDetail` on
 * 422/400 Pydantic error payloads before the caller sees them. Kept
 * local to this module so `api`, `sessionClient()`, `adminClient()`
 * all share the same behaviour.
 */
function _installErrorNormaliser(instance) {
  instance.interceptors.response.use(
    (r) => r,
    (err) => {
      try {
        const detail = err?.response?.data?.detail;
        if (detail != null) {
          err.response.data.detail = _normaliseDetail(detail);
        }
      } catch (_) {
        /* interceptor must never throw — swallow */
      }
      return Promise.reject(err);
    },
  );
  return instance;
}

export const api = _installErrorNormaliser(axios.create({ baseURL: API }));

export function adminClient(password) {
  // Two auth modes: legacy `X-Admin-Password` header (master env password)
  // OR a Bearer JWT issued by `/api/admin/login-with-email` for invited
  // team members. The frontend prefers the token if both are present.
  const token = sessionStorage.getItem("tv_admin_token");
  if (token) {
    return _installErrorNormaliser(
      axios.create({
        baseURL: API,
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  }
  return _installErrorNormaliser(
    axios.create({
      baseURL: API,
      headers: { "X-Admin-Password": password },
    }),
  );
}

export function setAdminTokenSession({ token, email, name }) {
  sessionStorage.setItem("tv_admin_token", token);
  sessionStorage.setItem("tv_admin_email", email);
  sessionStorage.setItem("tv_admin_name", name || email);
}

export function clearAdminSession() {
  sessionStorage.removeItem("tv_admin_token");
  sessionStorage.removeItem("tv_admin_email");
  sessionStorage.removeItem("tv_admin_name");
  sessionStorage.removeItem("tv_admin_pwd");
}

export function getAdminIdentity() {
  return {
    token: sessionStorage.getItem("tv_admin_token"),
    email: sessionStorage.getItem("tv_admin_email"),
    name: sessionStorage.getItem("tv_admin_name"),
    masterPwd: sessionStorage.getItem("tv_admin_pwd"),
  };
}

export function sessionClient() {
  const token = sessionStorage.getItem("tv_session_token");
  return _installErrorNormaliser(
    axios.create({
      baseURL: API,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

export function getSession() {
  const token = sessionStorage.getItem("tv_session_token");
  const role = sessionStorage.getItem("tv_session_role");
  const email = sessionStorage.getItem("tv_session_email");
  return token ? { token, role, email } : null;
}

export function setSession({ token, role, email }) {
  sessionStorage.setItem("tv_session_token", token);
  sessionStorage.setItem("tv_session_role", role);
  sessionStorage.setItem("tv_session_email", email);
}

export function clearSession() {
  sessionStorage.removeItem("tv_session_token");
  sessionStorage.removeItem("tv_session_role");
  sessionStorage.removeItem("tv_session_email");
}
