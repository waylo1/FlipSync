import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useMissionControlStore } from "./store/useMissionControlStore";
import "./index.css";

// Chargement initial piloté par le store (pas de useEffect côté composants) —
// déclenché une seule fois, hors cycle de rendu React.
void useMissionControlStore.getState().load();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
