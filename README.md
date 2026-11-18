# QDay Catalog

A minimal storefront that sells real API products for **tUSD8** on the **Aevum testnet**
(chain 44005), the official testnet of [QDay.io](https://qday.io) — built for the
[Aevum Builder Challenge #1](https://dorahacks.io/hackathon/qday/detail).

Built by Eric Cheng with an AI assistant (Koi), as declared in the transparency rules
of the challenge.

## What it does

1. The buyer picks a product on the catalog page and pays with tUSD8 (ERC-20 transfer
   to the merchant wallet, or via the payment contract).
2. The transaction hash is verified on-chain (RPC → receipt: status, recipient, amount).
3. Once confirmed, the corresponding product API is unlocked for real
   (live production API, not a mock).

## Products

| Product       | Price (tUSD8) | Description              |
|---------------|--------------:|--------------------------|
| crypto-price  | 1             | Live crypto price quotes |
| news-us       | 2             | US news feed             |
| grid-status   | 3             | Electricity grid status  |

## Network

- Aevum testnet RPC: `https://rpc-test.qday.info` (chain id 44005 / 0xabe5)
- Explorer: `https://explorer-test.qday.info`
- tUSD8 token: `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals)

## Stack

Solidity + Foundry (contracts), TypeScript/Node (verification service), plain
HTML/CSS/JS (storefront). See `docs/` for the architecture write-up (in progress).

## Status

🚧 Active build — Aevum Builder Challenge #1, submission deadline 2026-12-11 08:00 UTC.
All code in this repository is developed inside the official build window
(2026-11-16 → 2026-12-11).

## License

MIT
