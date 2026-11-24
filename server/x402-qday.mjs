// x402 resource server — QDay Aevum (hackathon).
// Serves the store catalogue and lets agents pay through OUR facilitator (a dedicated
// testnet instance, never the production one).
//
//   GET /                  -> static storefront (MetaMask payment)
//   GET /catalog           -> free, products read straight from the contract
//   GET /product/:id       -> 402 with payment terms, then 200 once settled
//   GET /health            -> status + network + merchant
//
// Payment follows x402: the client sends back an X-PAYMENT header (JSON, raw or base64)
// carrying a signed EIP-3009 authorization; the facilitator settles it.
import { createServer } from "node:http";
import { createPublicClient, http, getAddress, formatUnits } from "viem";

const PORT = Number(process.env.PORT || 8410);
const RPC = process.env.QDAY_RPC || "https://rpc-test.qday.info";
const TOKEN = getAddress(process.env.QDAY_TOKEN || "0x456569838f1d43009A91ebA4263147Afd7233483");
const MERCHANT = getAddress(process.env.QDAY_MERCHANT || "0xa044b8607AA7d37626Ae95025c830B02FeEDD3D3");
const ROUTER = getAddress(process.env.QDAY_ROUTER || "0x883Bc4f7A60aAE4c51aF8cb57e43Eb2Ea6a1b263");
const FACILITATOR = (process.env.FACILITATOR_URL || "http://127.0.0.1:8403").replace(/\/$/, "");
const NETWORK = "eip155:44005";
const BASE_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;

const chain = {
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "QDAY", symbol: "QDAY", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 15000, retryCount: 1 }) });

const ABI = [
  { name: "products", type: "function", stateMutability: "view",
    inputs: [{ name: "productId", type: "uint256" }],
    outputs: [{ name: "price", type: "uint128" }, { name: "active", type: "bool" }, { name: "name", type: "string" }] },
  { name: "productCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

async function loadProducts() {
  let n = 0n;
  try {
    n = await pub.readContract({ address: ROUTER, abi: ABI, functionName: "productCount" });
  } catch (_) {
    n = 0n;
  }
  const productsList = [];
  const total = Number(n) > 0 ? Number(n) : 8; // fallback: try the first 8 ids
  for (let id = 1; id <= total; id++) {
    try {
      const [price, active, name] = await pub.readContract({
        address: ROUTER, abi: ABI, functionName: "products", args: [BigInt(id)],
      });
      if (active) productsList.push({ id, name, price: price.toString(), price_display: formatUnits(price, 6) + " tUSD8" });
    } catch (_) { /* id inexistant */ }
  }
  return productsList;
}

const json = (res, code, corps, extra = {}) => {
  const body = JSON.stringify(corps);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE", ...extra });
  res.end(body);
};

function readPayment(req) {
  const brut = req.headers["x-payment"] || req.headers["X-PAYMENT"];
  if (!brut) return null;
  const s = String(brut).trim();
  const essais = [s];
  try { essais.push(Buffer.from(s, "base64").toString("utf8")); } catch (_) {}
  for (const t of essais) {
    try { const o = JSON.parse(t); if (o && typeof o === "object") return o; } catch (_) {}
  }
  return null;
}

// --- demo agent purchase (single-click x402 flow, testnet only) ---
// POST /demo/purchase/:id replays, server-side, what an x402 agent does:
//   1. GET  /product/:id             -> 402 + payment requirements
//   2. sign an EIP-3009 TransferWithAuthorization (demo buyer key)
//   3. POST facilitator /verify      -> signature + nonce checks
//   4. POST facilitator /settle      -> on-chain transferWithAuthorization
//   5. GET  /product/:id + X-PAYMENT -> 200 + deliverable
// Enabled only when QDAY_DEMO_BUYER_KEY is set (a throwaway TESTNET key).
const DEMO_BUYER = (process.env.QDAY_DEMO_BUYER_KEY || "").trim();
const DEMO_MAX_AMOUNT = BigInt(process.env.QDAY_DEMO_MAX_AMOUNT || "1000000"); // <= 1 tUSD8
const demoLastHit = new Map();
let demoBuyer = null;
if (DEMO_BUYER) {
  try { const { privateKeyToAccount } = await import("viem/accounts"); demoBuyer = privateKeyToAccount(DEMO_BUYER); }
  catch (e) { console.error("demo buyer key invalid:", String(e.message || e).slice(0, 120)); }
}

const demoTypes = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] };

async function demoPurchase(id, ip) {
  const now = Date.now();
  const key = ip + ":" + id;
  if (now - (demoLastHit.get(key) || 0) < 15000) return { code: 429, body: { error: "rate limited: one simulated purchase per product every 15 s" } };
  demoLastHit.set(key, now);
  if (!demoBuyer) return { code: 503, body: { error: "demo purchases disabled (no QDAY_DEMO_BUYER_KEY configured)" } };
  const steps = [];
  const step = (name, status, detail) => { steps.push({ step: steps.length + 1, name, status, detail }); };

  // 1) 402 with payment requirements
  const resource = `${BASE_URL}/product/${id}`;
  const [price, active, name] = await pub.readContract({ address: ROUTER, abi: ABI, functionName: "products", args: [BigInt(id)] });
  const priceS = price.toString();
  if (!active) return { code: 404, body: { error: "unknown or inactive product", id } };
  const amount = BigInt(priceS);
  if (amount > DEMO_MAX_AMOUNT) return { code: 400, body: { error: "product price above demo cap", cap: DEMO_MAX_AMOUNT.toString() } };
  const terms = {
    scheme: "exact", network: NETWORK, amount: priceS, maxAmountRequired: priceS, resource,
    description: `QDay catalogue - ${name}`, mimeType: "application/json", payTo: MERCHANT,
    maxTimeoutSeconds: 600, asset: TOKEN, extra: { name: "tUSD8", version: "2" },
  };
  step("Discover price (GET /product/:id)", "ok", { status: 402, amount: priceS, payTo: MERCHANT, asset: TOKEN });

  // 2) sign EIP-3009 authorization
  const { randomBytes } = await import("node:crypto");
  const validBefore = BigInt(Math.floor(now / 1000) + 600);
  const nonce = "0x" + randomBytes(32).toString("hex");
  const auth = { from: demoBuyer.address, to: MERCHANT, value: amount, validAfter: 0n, validBefore, nonce };
  const signature = await demoBuyer.signTypedData({
    domain: { name: "tUSD8", version: "2", chainId: 44005, verifyingContract: TOKEN },
    types: demoTypes, primaryType: "TransferWithAuthorization", message: auth,
  });
  step("Sign EIP-3009 authorization", "ok", { signer: demoBuyer.address, value: priceS, validBefore: validBefore.toString() });

  const payload = {
    x402Version: 2, scheme: "exact", network: NETWORK,
    payload: { signature, authorization: { from: auth.from, to: auth.to, value: priceS, validAfter: "0", validBefore: validBefore.toString(), nonce } },
  };
  const envelope = { x402Version: 2, paymentPayload: payload, paymentRequirements: terms };

  // 3) verify
  let v;
  try {
    v = await fetch(FACILITATOR + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope), signal: AbortSignal.timeout(60000) }).then(r => r.json());
  } catch (e) { return { code: 502, body: { error: "facilitator unreachable", steps } }; }
  step("Facilitator /verify", v.isValid ? "ok" : "failed", { isValid: !!v.isValid, invalidReason: v.invalidReason || null });
  if (!v.isValid) return { code: 402, body: { error: "PAYMENT-REJECTED", reason: v.invalidReason, steps } };

  // 4) paid request: the resource server settles through the facilitator on delivery
  const xpay = Buffer.from(JSON.stringify(payload)).toString("base64");
  let paid, paidBody;
  try {
    paid = await fetch(resource, { headers: { "X-PAYMENT": xpay }, signal: AbortSignal.timeout(60000) });
    paidBody = await paid.json().catch(() => ({}));
  } catch (e) { return { code: 502, body: { error: "resource unreachable", steps } }; }
  step("Deliver via X-PAYMENT (settle on request)", paid.status === 200 ? "ok" : "failed", {
    status: paid.status, deliverable: paidBody.deliverable ?? null,
    transaction: paidBody.transaction ?? null, reason: paidBody.reason ?? null,
  });
  return { code: paid.status === 200 ? 200 : paid.status, body: {
    service: "qday-aeuvm-catalog", mode: "simulated-agent-purchase", network: NETWORK,
    product: { id, name, price: priceS }, payer: paidBody.paid_by ?? null, transaction: paidBody.transaction ?? null,
    steps, deliverable: paidBody.deliverable ?? null,
  } };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  if (req.method === "OPTIONS") return json(res, 204, {});

  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, network: NETWORK, merchant: MERCHANT, token: TOKEN, router: ROUTER, facilitator: FACILITATOR });
  }

  if (url.pathname === "/" || url.pathname === "/shop") {
    // Human storefront: embedded static page, no server-side dependency.
    try {
      const fs = await import("node:fs/promises");
      const html = await fs.readFile(new URL("../web/index.html", import.meta.url), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "Cache-Control": "public, max-age=300",
      });
      return res.end(html);
    } catch (e) {
      return json(res, 500, { error: "page unavailable: " + String(e.message || e).slice(0, 160) });
    }
  }

  if (url.pathname === "/catalog") {
    try {
      const productsList = await loadProducts();
      return json(res, 200, { service: "qday-aeuvm-catalog", network: NETWORK, merchant: MERCHANT, asset: TOKEN, count: productsList.length, products: productsList });
    } catch (e) {
      return json(res, 503, { error: "catalog unavailable: " + String(e.message || e).slice(0, 160) });
    }
  }

  const dm = url.pathname.match(/^\/demo\/purchase\/(\d+)$/);
  if (dm && req.method === "POST") {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
    try { const r = await demoPurchase(Number(dm[1]), ip); return json(res, r.code, r.body); }
    catch (e) { return json(res, 500, { error: String(e.message || e).slice(0, 160) }); }
  }
  const m = url.pathname.match(/^\/product\/(\d+)$/);
  if (!m) return json(res, 404, { error: "not found", routes: ["/catalog", "/product/:id", "/health"] });

  const id = Number(m[1]);
  let productItem = null;
  try {
    const [price, active, name] = await pub.readContract({ address: ROUTER, abi: ABI, functionName: "products", args: [BigInt(id)] });
    if (active) productItem = { id, name, price: price.toString(), price_display: formatUnits(price, 6) + " tUSD8" };
  } catch (_) {}
  if (!productItem) return json(res, 404, { error: "unknown or inactive product", id });

  const resource = `${BASE_URL}/product/${id}`;
  const terms = {
    scheme: "exact",
    network: NETWORK,
    amount: productItem.price,
    maxAmountRequired: productItem.price,
    resource,
    description: `QDay catalogue — ${productItem.name}`,
    mimeType: "application/json",
    payTo: MERCHANT,
    maxTimeoutSeconds: 600,
    asset: TOKEN,
    extra: { name: "tUSD8", version: "2" },
  };

  const paiement = readPayment(req);
  if (!paiement) {
    return json(res, 402, { x402Version: 2, error: "PAYMENT-REQUIRED", accepts: [terms] });
  }

  try {
    const r = await fetch(FACILITATOR + "/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentRequirements: terms, paymentPayload: paiement }),
      signal: AbortSignal.timeout(150000),
    });
    const settlement = await r.json().catch(() => ({}));
    if (!settlement || settlement.success !== true) {
      return json(res, 402, {
        x402Version: 2, error: "PAYMENT-REJECTED",
        reason: (settlement && settlement.errorReason) || "settlement refused",
        accepts: [terms],
      });
    }
    const recu = Buffer.from(JSON.stringify({ success: true, network: NETWORK, transaction: settlement.transaction, payer: settlement.payer, settled_at: settlement.settled_at })).toString("base64");
    return json(res, 200, {
      service: "qday-aeuvm-catalog", network: NETWORK,
      product: productItem,
      paid_by: settlement.payer, transaction: settlement.transaction, block: settlement.block,
      deliverable: { note: "content delivered after x402 settlement (sample)", product_id: id, license: "internal use, testnet only" },
    }, { "X-PAYMENT-RESPONSE": recu });
  } catch (e) {
    return json(res, 502, { error: "facilitator unreachable: " + String(e.message || e).slice(0, 160) });
  }
});

server.listen(PORT, () => {
  console.log(`x402 QDay listening on ${PORT} — network ${NETWORK} — merchant ${MERCHANT}`);
  console.log(`facilitator: ${FACILITATOR}`);
});
