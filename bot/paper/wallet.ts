import { ethers } from 'ethers'
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config/index.js'
import { deriveSafe } from '@polymarket/builder-relayer-client/dist/builder/derive.js'
import { CHAIN_ID } from '@/lib/polymarket/constants'

export type PaperWallet = {
  privateKey: string
  address: string
  safeAddress: string
  mnemonic: string
}

/**
 * Generate a fresh Ethereum wallet and derive its deterministic
 * Polymarket Safe address — no on-chain transaction needed.
 */
export function generateWallet(): PaperWallet {
  const wallet = ethers.Wallet.createRandom()
  const config = getContractConfig(CHAIN_ID)
  const safeAddress = deriveSafe(wallet.address, config.SafeContracts.SafeFactory)

  return {
    privateKey: wallet.privateKey,
    address: wallet.address,
    safeAddress,
    mnemonic: wallet.mnemonic.phrase,
  }
}

/**
 * Restore a wallet from a previously generated private key.
 */
export function restoreWallet(privateKey: string): PaperWallet {
  const wallet = new ethers.Wallet(privateKey)
  const config = getContractConfig(CHAIN_ID)
  const safeAddress = deriveSafe(wallet.address, config.SafeContracts.SafeFactory)

  return {
    privateKey: wallet.privateKey,
    address: wallet.address,
    safeAddress,
    mnemonic: '',
  }
}
