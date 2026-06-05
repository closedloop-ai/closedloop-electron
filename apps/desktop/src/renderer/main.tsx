import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignSystemProvider } from "@closedloop-ai/design-system";
import "./globals.css";
import "@closedloop-ai/design-system/styles/globals.css";
import App from "./App";

window.addEventListener("error", (event) => {
  console.error("[renderer]", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[renderer] unhandled rejection:", event.reason);
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <DesignSystemProvider
      attribute="class"
      defaultTheme="light"
      disableTransitionOnChange
      enableSystem={false}
    >
      <App />
    </DesignSystemProvider>
  </StrictMode>,
);
