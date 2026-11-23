# x402 on Aevum — self-hosted facilitator + resource server

This folder holds the two off-chain pieces of the QDay / Aevum submission. Both are
public and runnable as-is: no hosted third party sits between the buyer and the chain.

```
server/x402-qday.mjs      x402 resource server (paid catalogue endpoint)
../facilitator/           self-hosted x402 facilitator (EIP-3009 verify + settle)
```

## Why a facilitator of our own

x402 needs someone to check a signed payment authorisation and to submit it on-chain.
Most x402 deployments hand that job to Coinbase CDP or to PayAI. This project runs its
own facilitator: it verifies the EIP-712 signature, checks the nonce and the amount,
then a relay key pays the gas and calls `transferWithAuthorization` on the token. Funds
move payer -> merchant directly; the relay never holds them.

The same code serves Base, Polygon, Arbitrum One, Robinhood Chain (USDG) and Solana in
production at https://facilitator.xynaptic.io. Aevum (chain 44005) is enabled only when
`QDAY_TESTNET=1`, so the testnet network can never appear in the production `/supported`
list.

## Aevum specifics, verified on-chain

| item | value |
|---|---|
| chain id | `44005` |
| RPC | `https://rpc-test.qday.info` |
| settlement token (tUSD8) | `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals) |
| EIP-712 domain | `name: "tUSD8"`, `version: "2"` |
| merchant (this project) | `0xa044b8607AA7d37626Ae95025c830B02FeEDD3D3` |
| deployed contract | `0x883Bc4f7A60aAE4c51aF8cb57e43Eb2Ea6a1b263` (PaymentRouter) |

**The domain name is not the token name.** `name()` returns `TUSD8` in upper case, but
the on-chain `DOMAIN_SEPARATOR` matches `tUSD8` with a lower-case `t`. Signing with the
upper-case name makes every settlement revert with `FiatTokenV2: invalid signature`.
The value above was confirmed by recomputing the separator for six candidates and
comparing to `DOMAIN_SEPARATOR()` on the token.

Also: the EVM is Shanghai, not Cancun. Compile with `evm_version = "shanghai"`, and
avoid transient-storage helpers, or deployment succeeds and the call reverts later.

## Endpoints

`server/x402-qday.mjs`

- `GET /catalog` — free. Reads the products straight from the deployed contract.
- `GET /product/:id` — free of charge it answers `402` with the x402 terms; send the
  payment in `X-PAYMENT` (raw JSON or base64) and it settles through the facilitator,
  then returns the content plus an `X-PAYMENT-RESPONSE` receipt.
- `GET /health` — network, merchant, token, facilitator in use.

Run locally:

```bash
export QDAY_MERCHANT=0xa044b8607AA7d37626Ae95025c830B02FeEDD3D3
PORT=8410 FACILITATOR_URL=http://127.0.0.1:8403 node server/x402-qday.mjs
```

Facilitator instance (separate key, separate port):

```bash
cd ../facilitator
QDAY_TESTNET=1 RELAYER_PRIVATE_KEY=<qday relayer key> PORT=8403 node src/server.mjs
```

## Proven on Aevum

| what | transaction |
|---|---|
| facilitator settle, direct to merchant | `0xd51d1bfca624dabc15895aa37637c3b14d866c8ba32dba174a6ee4e4cb1eab90` |

That call started with a `402`, carried an EIP-3009 authorisation, was settled by the
relay key `0xb141B75A864B399d56c68Fd798e4061625B679C9`, and returned `200` with the
receipt above. 0.01 tUSD8 landed on the merchant wallet, gas cost ~100k.

## Human path

The storefront (`web/index.html`) keeps the MetaMask flow: connect, approve, `pay()`.
Humans pay by wallet; agents pay by x402. Both settle in tUSD8 on Aevum.
