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

## The five paid endpoints, tested for real

All five products of the catalogue were bought through the x402 flow on 2026-11-23
between 06:50 and 06:52 UTC. Each line is a distinct settlement by the relay key
`0xb141B75A864B399d56c68Fd798e4061625B679C9`, paid to the merchant
`0xa044b8607AA7d37626Ae95025c830B02FeEDD3D3`.

| # | product (contract name) | price | duration | block | transaction |
|---|---|---|---|---|---|
| 1 | crypto-price — live crypto quotes | 0.01 tUSD8 | 8.0 s | 3897794 | `0x78a98adeff19330e8a7cf812ea40a4d2c63e8f351ad817b6af2a87a1ec581dc3` |
| 2 | news-us — US financial news feed | 0.01 tUSD8 | 41.9 s | 3897826 | `0x702ae48cd3cf537f022181ab150a6c3c8aa64bffda79095e5dcfa8cf788027ad` |
| 3 | security-price — live stock quotes | 0.01 tUSD8 | 13.8 s | 3897848 | `0x7dbba6206355554e309f8699d5e6cfd2f89ad96abd533fb045e6f1d9286fbc91` |
| 4 | intermodal-compare — multimodal routes | 0.03 tUSD8 | 17.4 s | 3897868 | `0x54e8255ec386dd36fb96d85e639370c7b5a312824f861fe9fb421ccdcc715938` |
| 5 | restaurant-nearby — restaurants near a FR address | 0.05 tUSD8 | 6.5 s | 3897879 | `0x35a9368fb78c26359ca8e076cea942a1a57edcf13f5f27731b24e514852c2005` |

Explorer: `https://explorer-test.qday.info/tx/<hash>`

**Aevum settlement latency.** The four earlier attempts ranged from 13 s to 48 s end
to end. Our resource server waited 45 s at first and one settlement came back as a
`502` simply because the chain took 47 s. The client timeout is now 150 s. On this
testnet, budget tens of seconds per payment, not seconds.

## Calling an endpoint

Free discovery, no payment:

```bash
curl -s https://<host>/catalog
```

```json
{
  "service": "qday-aeuvm-catalog",
  "network": "eip155:44005",
  "merchant": "0xa044b8607AA7d37626Ae95025c830B02FeEDD3D3",
  "asset": "0x456569838f1d43009A91ebA4263147Afd7233483",
  "count": 5,
  "products": [
    { "id": 1, "name": "Xynaptic crypto-price - live crypto quotes (BTC/ETH/SOL/ADA)", "price": "10000", "price_display": "0.01 tUSD8" }
  ]
}
```

A call without payment answers `402` and states the terms:

```bash
curl -s -i https://<host>/product/1
```

```json
{
  "x402Version": 2,
  "error": "PAYMENT-REQUIRED",
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:44005",
    "amount": "10000",
    "maxAmountRequired": "10000",
    "resource": "https://<host>/product/1",
    "payTo": "0xa044b8607AA7d37626Ae95025c830B02FeEDD3D3",
    "asset": "0x456569838f1d43009A91ebA4263147Afd7233483",
    "extra": { "name": "tUSD8", "version": "2" },
    "maxTimeoutSeconds": 600
  }]
}
```

The client signs an EIP-3009 `TransferWithAuthorization` for exactly that amount, sends
it back as base64 JSON in `X-PAYMENT`, and receives the content plus a receipt header:

```json
{
  "service": "qday-aeuvm-catalog",
  "network": "eip155:44005",
  "product": { "id": 1, "name": "Xynaptic crypto-price - live crypto quotes (BTC/ETH/SOL/ADA)", "price": "10000" },
  "paid_by": "0xb141B75A864B399d56c68Fd798e4061625B679C9",
  "transaction": "0x78a98adeff19330e8a7cf812ea40a4d2c63e8f351ad817b6af2a87a1ec581dc3",
  "block": 3897794,
  "deliverable": { "note": "contenu livre apres reglement x402 (exemple)", "product_id": 1, "licence": "usage interne, testnet" }
}
```

`X-PAYMENT-RESPONSE` carries the same receipt, base64-encoded:

```json
{ "success": true, "network": "eip155:44005", "transaction": "0x78a9…1dc3",
  "payer": "0xb141B75A864B399d56c68Fd798e4061625B679C9", "settled_at": "2026-11-23T06:50:54.555Z" }
```
