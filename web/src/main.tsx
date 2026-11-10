import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { AuthProvider } from "./lib/auth";
import "./styles.css";

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => n < 2 && (e as { status?: number }).status !== 401 && (e as { status?: number }).status !== 403, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
