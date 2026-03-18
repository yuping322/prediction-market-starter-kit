"use client"

import { providers } from "ethers"
import { encodeFunctionData, maxUint256, createPublicClient, http } from "viem"
import { polygon } from "viem/chains"
import { BuilderConfig } from "@polymarket/builder-signing-sdk"
import { RelayClient, RelayerTransactionState, OperationType } from "@polymarket/builder-relayer-client"
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive.js"
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config/index.js"
import {
  CHAIN_ID,
  RELAYER_URL,
  USDC_ADDRESS,
  CTF_ADDRESS,
  CTF_EXCHANGE,
  NEG_RISK_CTF_EXCHANGE,
  NEG_RISK_ADAPTER,
  ERC20_ABI,
} from "./constants"

const REMOTE_SIGNING_URL = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/api/builder-sign`
    : "/api/builder-sign"

const ERC1155_SET_APPROVAL_ABI = [
  {
    name: "setApprovalForAll",
    type: "function",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEthersSigner(eip1193Provider: any) {
  const ethersProvider = new providers.Web3Provider(eip1193Provider)
  return ethersProvider.getSigner()
}

export function createRelayClient(ethersSigner: providers.JsonRpcSigner) {
  const builderConfig = new BuilderConfig({
    remoteBuilderConfig: {
      url: REMOTE_SIGNING_URL(),
    },
  })

  return new RelayClient(
    RELAYER_URL,
    CHAIN_ID,
    ethersSigner,
    builderConfig,
  )
}

export function deriveSafeAddress(eoaAddress: string): string {
  const config = getContractConfig(CHAIN_ID)
  return deriveSafe(eoaAddress, config.SafeContracts.SafeFactory)
}

export async function isSafeDeployed(
  _relayClient: RelayClient,
  safeAddress: string,
): Promise<boolean> {
  try {
    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(),
    })
    const code = await publicClient.getCode({ address: safeAddress as `0x${string}` })
    return !!code && code !== "0x"
  } catch {
    return false
  }
}

export async function deploySafeWallet(
  relayClient: RelayClient,
): Promise<string> {
  const response = await relayClient.deploy()

  const result = await relayClient.pollUntilState(
    response.transactionID,
    [
      RelayerTransactionState.STATE_MINED,
      RelayerTransactionState.STATE_CONFIRMED,
      RelayerTransactionState.STATE_FAILED,
    ],
    "60",
    3000,
  )

  if (!result) {
    throw new Error("Safe deployment failed — no result from relayer")
  }

  return result.proxyAddress ?? ""
}

export async function setAllTokenApprovals(
  relayClient: RelayClient,
): Promise<void> {
  const erc20Spenders = [CTF_ADDRESS, CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER]
  const erc1155Operators = [CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER]

  const txs = [
    ...erc20Spenders.map((spender) => ({
      to: USDC_ADDRESS,
      operation: OperationType.Call,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, maxUint256],
      }),
      value: "0",
    })),
    ...erc1155Operators.map((operator) => ({
      to: CTF_ADDRESS,
      operation: OperationType.Call,
      data: encodeFunctionData({
        abi: ERC1155_SET_APPROVAL_ABI,
        functionName: "setApprovalForAll",
        args: [operator, true],
      }),
      value: "0",
    })),
  ]

  const response = await relayClient.execute(txs, "Set all token approvals for trading")
  await response.wait()
}

export async function transferToSafe(
  ethersSigner: providers.JsonRpcSigner,
  safeAddress: string,
  amount: bigint,
): Promise<string> {
  const transferData = encodeFunctionData({
    abi: [
      {
        name: "transfer",
        type: "function",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
      },
    ] as const,
    functionName: "transfer",
    args: [safeAddress as `0x${string}`, amount],
  })

  const tx = await ethersSigner.sendTransaction({
    to: USDC_ADDRESS,
    data: transferData,
  })

  const receipt = await tx.wait()
  return receipt.transactionHash
}
