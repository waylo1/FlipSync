import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useMissionControlStore, DEFAULT_POLL_INTERVAL_MS } from "./store/useMissionControlStore";
import "./index.css";

// Chargement initial + polling piloté par le store (pas de useEffect côté composants) —
// déclenché une seule fois, hors cycle de rendu React. Logs/Alertes restent à jour
// sans clic Refresh. startPolling nettoie tout intervalle précédent (cf. stopPolling
// dans useMissionControlStore) avant d'en ouvrir un nouveau.
useMissionControlStore.getState().startPolling(DEFAULT_POLL_INTERVAL_MS);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
