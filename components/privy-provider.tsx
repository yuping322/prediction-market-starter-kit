"use client"

import { PrivyProvider as BasePrivyProvider } from "@privy-io/react-auth"
import { addRpcUrlOverrideToChain } from "@privy-io/chains"
import { useTheme } from "next-themes"
import { polygon } from "viem/chains"

const POLYGON_RPC_URL = process.env.NEXT_PUBLIC_POLYGON_RPC_URL || "https://polygon.drpc.org"

function PrivyProviderInner({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme()

  return (
    <BasePrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ""}
      config={{
        appearance: {
          theme: resolvedTheme === "dark" ? "dark" : "light",
          accentColor: "#2563eb",
          landingHeader: "Sign in to trade",
          loginMessage: "Connect your wallet or sign in with email to get started.",
        },
        loginMethods: ["email", "wallet"],
        defaultChain: polygon,
        supportedChains: [addRpcUrlOverrideToChain(polygon, POLYGON_RPC_URL)],
        embeddedWallets: {
          showWalletUIs: false,
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  )
}

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return <PrivyProviderInner>{children}</PrivyProviderInner>
}
