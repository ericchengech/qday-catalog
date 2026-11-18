# Architecture (work in progress)

Transaction flow:

1. Browser (catalog page): the user picks a product.
2. MetaMask (Aevum testnet, chain 44005): tUSD8 transfer to the merchant wallet.
3. Verification service (Node): tx hash -> RPC receipt (status, recipient, amount).
4. Unlock: the real production API call is granted.

Details on the payment contract, session-scoped spending caps and the receipt
verification flow will be documented here as the code lands.
