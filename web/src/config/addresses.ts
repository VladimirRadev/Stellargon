import type { Address } from 'viem'

/** Ethereum Sepolia. */
export const CHAIN_ID = 11155111 as const

/**
 * Deployed contract addresses on Sepolia (source of truth: deployments/sepolia.json).
 * A zero address is a placeholder: the UI shows a "not deployed yet" state for it.
 */
export const addresses = {
  vladToken: '0x49ba857d553ef219B144b200F41acaf8CB6768E9',
  oracle: '0x100B01F4b09Ab26A4E941E3f3c470Ce5fCA1CcE9',
  predict: '0xb9FA67c0C2141d0F0fcB17F81fC53ad918f776FD',
} as const satisfies Record<string, Address>

/** Contracts listed in the footer, with Blockscout links. */
export const footerContracts: readonly { label: string; address: Address }[] = [
  { label: 'VladToken ($VLAD)', address: addresses.vladToken },
  { label: 'StellarOracle', address: addresses.oracle },
  { label: 'StellarPredict', address: addresses.predict },
]
