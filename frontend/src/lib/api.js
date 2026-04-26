import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

export function adminClient(password) {
  return axios.create({
    baseURL: API,
    headers: { "X-Admin-Password": password },
  });
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
