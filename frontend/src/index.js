import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
// Sentry init MUST run before React.createRoot so the SDK's global
// error/unhandledrejection hooks are in place before any component
// can throw. Silent no-op if REACT_APP_SENTRY_DSN isn't set.
import { initSentry } from "@/lib/sentry";

initSentry();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
