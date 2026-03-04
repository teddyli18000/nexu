import * as amplitude from "@amplitude/unified";
import { Identify } from "@amplitude/unified";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./app";
import {
  ThemeProvider,
  initializeTheme,
  useTheme,
} from "./components/theme-provider";
import "./index.css";

const amplitudeApiKey = import.meta.env.VITE_AMPLITUDE_API_KEY;
if (amplitudeApiKey) {
  amplitude.initAll(amplitudeApiKey, {
    analytics: { autocapture: true },
    sessionReplay: { sampleRate: 1 },
  });
  const env = new Identify();
  env.set("environment", import.meta.env.MODE);
  amplitude.identify(env);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

initializeTheme();

function AppContent() {
  const { resolvedTheme } = useTheme();

  return (
    <>
      <App />
      <Toaster position="top-right" theme={resolvedTheme} />
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
