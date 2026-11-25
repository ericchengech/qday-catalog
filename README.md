# Xynaptic Store on QDay Aevum

A working x402 storefront on the QDay Aevum testnet: a smart contract that holds the
product catalogue and per-agent spending sessions, a human storefront with MetaMask
checkout, and an agent interface - all settled in tUSD8 through the x402 payment protocol.

Submitted for **Aevum Builder Challenge #1** (dorahacks.io/hackathon/qday).

## Problem

Autonomous AI agents need to buy digital services (API data, briefs, verifications) without
a human confirming every payment. Card rails cannot do this; raw private keys in agents are
unsafe. The x402 pattern (HTTP 402 + signed payment) solves the protocol side; what is still
missing in practice is **scoped, on-chain spending control** for agents. This project adds it:
the merchant contract keeps a per-agent budget (cap) and rejects any purchase above it.

## Architecture

    Human browser (MetaMask) \
                                --> PaymentRouter (Aevum 44005) <-- tUSD8 (EIP-3009)
    AI agent (x402 X-PAYMENT) /            ^
                                    x402 facilitator (dedicated testnet instance)

- **PaymentRouter.sol** - on-chain catalogue (id -> price, name, active) and agent sessions
  (setAgent(agent, cap, authorized)). pay(productId, txHash) transfers tUSD8 from the
  payer via transferWithAuthorization (EIP-3009 / x402), enforces the agent cap, records
  the settlement tx hash, and emits an event.
- **Human storefront (/)** - static page, MetaMask payment, catalogue read live from the
  contract. For human testers without tUSD8, the footer offers a top-up: send your address
  and we fund you from the merchant test key.
- **Agent interface (/agents)** - same catalogue for machine/human-agent testers, plus a
  simulated end-to-end x402 purchase demo (1 purchase per product per 15 s per IP).
- **x402 resource server** (server/x402-qday.mjs, Node, no framework) - serves both
  fronts, exposes GET /catalog, GET /product/:id (402 -> 200 after settlement),
  GET /health; settles payments through a **dedicated x402 facilitator testnet instance**
  (never production). Rate-limited.

## Aevum testnet (chainId 44005)

- PaymentRouter (this project): 0x883Bc4f7A60aAE4c51aF8cb57e43Eb2Ea6a1b263
- tUSD8 (6 decimals): 0x456569838f1d43009A91ebA4263147Afd7233483
- Merchant account: 0xa044b8607AA7d37626Ae95025c830B02FeEDD3D3
- RPC: https://rpc-test.qday.info
- Explorer: https://explorer-test.qday.info/
- Faucet: https://faucet.qday.info/en

Demo purchase settled on testnet: tx 0x78d9c68c... by agent 0x8E813831D30c47aCA0e12e92c35FE341EEd0c9A3.

## Run it

    # contracts (Foundry)
    forge build && forge test

    # storefront + x402 resource server
    npm install          # or: npm i ethers
    PORT=8410 node server/x402-qday.mjs

Environment (all optional, defaults are the testnet addresses above):
PORT, QDAY_RPC, QDAY_TOKEN, QDAY_MERCHANT, QDAY_ROUTER, FACILITATOR_URL, PUBLIC_URL.
No secrets required to serve and browse; the merchant key is only needed to top up
testers and is kept out of the repository.

## x402 flow (agent path)

1. GET /product/1 -> 402 with payment terms (amount, asset, merchant, nonce window).
2. Agent signs an EIP-3009 transferWithAuthorization over tUSD8 and sends it as the
   X-PAYMENT header (JSON, raw or base64).
3. Server forwards the envelope to the facilitator /settle; the facilitator submits the
   meta-transaction and returns the on-chain result.
4. Server re-serves the resource with 200 + X-PAYMENT receipt (tx hash, explorer link).

## Safety

- Per-agent spending cap enforced **on-chain** (revert "agent cap exceeded"), not client-side.
- Settlement tx hashes are recorded on-chain and idempotent ("tx already settled").
- Demo purchases are rate-limited; no production credentials anywhere in this repository.
- The facilitator used for settlement is a dedicated testnet-only instance.

## Tech

Solidity 0.8 (Foundry), Node.js + ethers, x402 (HTTP 402 + EIP-3009), QDay Aevum testnet.

## Team

ericKoch - design, contracts, storefront - with Koi, an OpenClaw agent (build assistant).
