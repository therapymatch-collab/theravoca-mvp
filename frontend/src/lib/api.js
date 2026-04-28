import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

export function adminClient(password) {
  // Two auth modes: legacy `X-Admin-Password` header (master env password)
  // OR a Bearer JWT issued by `/api/admin/login-with-email` for invited
  // team members. The frontend prefers the token if both are present.
  const token = sessionStorage.getItem("tv_admin_token");
  if (token) {
    return axios.create({
      baseURL: API,
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  return axios.create({
    baseURL: API,
    headers: { "X-Admin-Password": password },
  });
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
  return axios.create({
    baseURL: API,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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
