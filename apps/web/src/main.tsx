import "@/lib/western-digits"; // Western digits 0-9 by default in Arabic (founder decision 28 Nov 2026)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";
import "@/styles/globals.css";
import { initTheme } from "@/brand/ui-kit";
import { App } from "@/app/App";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";

const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 5_000 } } });

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
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

// PWA: the phlebotomist route works offline (app shell cache + IndexedDB write queue)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
