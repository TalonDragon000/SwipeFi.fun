import { StrictMode, useEffect, useState } from "react";
import { preload } from "react-dom";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions
} from "@solana/kit";
import "@fontsource/archivo-black/400.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/instrument-serif/400.css";
import instrumentSerifRegularUrl from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url";
import { APP_NAME } from "../domain/brand";
import { App } from "./App";
import { api, type PublicConfig } from "./api";
import "./styles.css";

preload(instrumentSerifRegularUrl, {
  as: "font",
  crossOrigin: "anonymous",
  type: "font/woff2"
});

function Root() {
  const [config, setConfig] = useState<PublicConfig>();
  const [error, setError] = useState("");

  useEffect(() => {
    api.config()
      .then(setConfig)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Could not load app configuration")
      );
  }, []);

  if (error) {
    return <main className="fatal-state"><h1>{APP_NAME} is unavailable</h1><p>{error}</p></main>;
  }
  if (!config) {
    return <main className="loading-state"><span /><h1>Loading {APP_NAME}</h1></main>;
  }

  return (
    <PrivyProvider
      appId={config.privy.appId}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#baff00",
          walletChainType: "solana-only",
          walletList: [
            "phantom",
            "solflare",
            "backpack",
            "jupiter",
            "detected_solana_wallets",
            "wallet_connect_qr_solana"
          ]
        },
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors({ shouldAutoConnect: false })
          }
        },
        embeddedWallets: {
          solana: { createOnLogin: "all-users" }
        },
        solana: {
          rpcs: {
            "solana:mainnet": {
              rpc: createSolanaRpc(`${window.location.origin}/api/solana/rpc`),
              rpcSubscriptions: createSolanaRpcSubscriptions(
                "wss://api.mainnet-beta.solana.com"
              ),
              blockExplorerUrl: "https://explorer.solana.com"
            }
          }
        },
      }}
    >
      <App config={config} />
    </PrivyProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

createRoot(root).render(
  <StrictMode>
    <Root />
    <Analytics />
  </StrictMode>
);
