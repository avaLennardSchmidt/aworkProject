import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { DetailModalProvider } from "./context/DetailModalContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <MotionConfig reducedMotion="user">
          <DetailModalProvider>
            <App />
          </DetailModalProvider>
        </MotionConfig>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
