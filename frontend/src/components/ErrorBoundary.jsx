// Top-level ErrorBoundary — catches any rendering exception in the
// React tree below it and shows a graceful fallback UI instead of
// blanking the page. Wrapped around <Routes> in App.js so a single
// thrown component never takes down the whole app.
//
// We deliberately do NOT log to a remote service here — the backend
// already captures structured logs for API failures, and surfacing
// runtime stack traces externally for an unauth'd visitor would be a
// security smell. We do `console.error` so the error still surfaces
// in DevTools during development.
import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { hasError: false, errorMsg: "" };

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMsg: (error && error.message) || "Unexpected error",
    };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMsg: "" });
    // Soft refresh — clears any half-rendered state but keeps SPA mount
    // intact. Falls back to full reload if window.history doesn't play.
    try {
      if (typeof window !== "undefined" && window.location) {
        window.location.reload();
      }
    } catch (_) {
      /* no-op */
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6"
          data-testid="error-boundary-fallback"
        >
          <div className="max-w-md text-center space-y-4">
            <div className="text-5xl mb-2">😶</div>
            <h1 className="font-serif-display text-3xl text-[#2D4A3E]">
              Something went sideways.
            </h1>
            <p className="text-sm text-[#6D6A65] leading-relaxed">
              We hit an unexpected error rendering this page. Refreshing
              usually clears it. If it keeps happening, please{" "}
              <a
                href="mailto:hello@theravoca.com"
                className="underline text-[#2D4A3E]"
              >
                let us know
              </a>{" "}
              and we&rsquo;ll look at it directly.
            </p>
            {this.state.errorMsg && (
              <p
                className="text-xs italic text-[#9C9893] break-words"
                data-testid="error-boundary-message"
              >
                {this.state.errorMsg}
              </p>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 rounded-full bg-[#2D4A3E] text-white text-sm font-medium hover:bg-[#1F3A30] transition"
              data-testid="error-boundary-reload-btn"
            >
              Refresh and try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
