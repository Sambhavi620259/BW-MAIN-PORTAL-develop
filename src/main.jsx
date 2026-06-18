import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ThemeProvider } from "./context/ThemeContext";
import { BrandProvider } from "./context/BrandContext";
import { AuthProvider } from "./context/AuthContext";
import { NotificationInboxProvider } from "./context/NotificationInboxContext";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrandProvider>
      <ThemeProvider>
        <AuthProvider>
          <NotificationInboxProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </NotificationInboxProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrandProvider>
  </React.StrictMode>,
);
