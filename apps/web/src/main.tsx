import { registerSW } from "virtual:pwa-register";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/dm-mono/latin-500.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-600.css";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

async function clearPwaRuntimeCache() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  }
}

class AppFailureBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Finance Hero failed to render", error, info);
  }

  private repair = async () => {
    await clearPwaRuntimeCache();
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main
        style={{
          minHeight: "100vh",
          padding: "clamp(2rem, 8vw, 6rem)",
          background: "#f4f0e6",
          color: "#10251f",
          fontFamily: "Manrope, sans-serif",
        }}
      >
        <p style={{ fontFamily: "DM Mono, monospace", letterSpacing: "0.12em" }}>
          FINANCE HERO / RECOVERY
        </p>
        <h1 style={{ maxWidth: "18ch", fontSize: "clamp(2rem, 6vw, 4.5rem)" }}>
          Finance Hero could not start.
        </h1>
        <p style={{ maxWidth: "60ch", fontSize: "1.1rem" }}>
          Your local financial data is safe. Reload the app, or repair its cached
          frontend if the problem continues.
        </p>
        <pre
          style={{
            maxWidth: "70rem",
            overflow: "auto",
            padding: "1rem",
            border: "1px solid #c8c3b8",
            background: "#fffdf7",
          }}
        >
          {this.state.error.message}
        </pre>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
          <button type="button" onClick={() => void this.repair()}>
            Repair cached app
          </button>
        </div>
      </main>
    );
  }
}

if (import.meta.env.PROD) {
  registerSW({
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent("finance-hero:update-ready"));
    },
  });
} else if ("serviceWorker" in navigator) {
  // Vite's development worker can outlive the local server and keep an installed
  // PWA on an obsolete bundle. The local API is required anyway, so development
  // always uses the live fixed-port frontend instead of cached application code.
  void clearPwaRuntimeCache();
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <AppFailureBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppFailureBoundary>
  </StrictMode>,
);
