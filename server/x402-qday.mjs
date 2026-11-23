// x402 resource server — QDay Aevum (hackathon).
// Sert le catalogue de la boutique et fait payer les agents via NOTRE facilitateur
// (instance dediee testnet, jamais celle de production).
//
//   GET /catalog            -> gratuit, liste des produits lus on-chain
//   GET /product/:id        -> 402 avec les termes de paiement, puis 200 si regle
//   GET /health             -> etat + reseau + marchand
//
// Le paiement suit x402 : le client renvoie l'entete X-PAYMENT (JSON, brut ou base64)
// contenant une autorisation EIP-3009 signee ; on la fait regler par le facilitateur.
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

async function chargerProduits() {
  let n = 0n;
  try {
    n = await pub.readContract({ address: ROUTER, abi: ABI, functionName: "productCount" });
  } catch (_) {
    n = 0n;
  }
  const produits = [];
  const total = Number(n) > 0 ? Number(n) : 8; // repli : on tente les 8 premiers id
  for (let id = 1; id <= total; id++) {
    try {
      const [price, active, name] = await pub.readContract({
        address: ROUTER, abi: ABI, functionName: "products", args: [BigInt(id)],
      });
      if (active) produits.push({ id, name, price: price.toString(), price_display: formatUnits(price, 6) + " tUSD8" });
    } catch (_) { /* id inexistant */ }
  }
  return produits;
}

const json = (res, code, corps, extra = {}) => {
  const body = JSON.stringify(corps);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE", ...extra });
  res.end(body);
};

function lirePaiement(req) {
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

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  if (req.method === "OPTIONS") return json(res, 204, {});

  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, network: NETWORK, merchant: MERCHANT, token: TOKEN, router: ROUTER, facilitator: FACILITATOR });
  }

  if (url.pathname === "/catalog") {
    try {
      const produits = await chargerProduits();
      return json(res, 200, { service: "qday-aeuvm-catalog", network: NETWORK, merchant: MERCHANT, asset: TOKEN, count: produits.length, products: produits });
    } catch (e) {
      return json(res, 503, { error: "catalogue indisponible: " + String(e.message || e).slice(0, 160) });
    }
  }

  const m = url.pathname.match(/^\/product\/(\d+)$/);
  if (!m) return json(res, 404, { error: "not found", routes: ["/catalog", "/product/:id", "/health"] });

  const id = Number(m[1]);
  let produit = null;
  try {
    const [price, active, name] = await pub.readContract({ address: ROUTER, abi: ABI, functionName: "products", args: [BigInt(id)] });
    if (active) produit = { id, name, price: price.toString(), price_display: formatUnits(price, 6) + " tUSD8" };
  } catch (_) {}
  if (!produit) return json(res, 404, { error: "produit inconnu ou inactif", id });

  const resource = `${BASE_URL}/product/${id}`;
  const terms = {
    scheme: "exact",
    network: NETWORK,
    amount: produit.price,
    maxAmountRequired: produit.price,
    resource,
    description: `QDay catalogue — ${produit.name}`,
    mimeType: "application/json",
    payTo: MERCHANT,
    maxTimeoutSeconds: 600,
    asset: TOKEN,
    extra: { name: "tUSD8", version: "2" },
  };

  const paiement = lirePaiement(req);
  if (!paiement) {
    return json(res, 402, { x402Version: 2, error: "PAYMENT-REQUIRED", accepts: [terms] });
  }

  try {
    const r = await fetch(FACILITATOR + "/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentRequirements: terms, paymentPayload: paiement }),
      signal: AbortSignal.timeout(45000),
    });
    const reglement = await r.json().catch(() => ({}));
    if (!reglement || reglement.success !== true) {
      return json(res, 402, {
        x402Version: 2, error: "PAIEMENT-REJETE",
        raison: (reglement && reglement.errorReason) || "reglement refuse",
        accepts: [terms],
      });
    }
    const recu = Buffer.from(JSON.stringify({ success: true, network: NETWORK, transaction: reglement.transaction, payer: reglement.payer, settled_at: reglement.settled_at })).toString("base64");
    return json(res, 200, {
      service: "qday-aeuvm-catalog", network: NETWORK,
      product: produit,
      paid_by: reglement.payer, transaction: reglement.transaction, block: reglement.block,
      deliverable: { note: "contenu livre apres reglement x402 (exemple)", product_id: id, licence: "usage interne, testnet" },
    }, { "X-PAYMENT-RESPONSE": recu });
  } catch (e) {
    return json(res, 502, { error: "facilitateur injoignable: " + String(e.message || e).slice(0, 160) });
  }
});

serveur.listen(PORT, () => {
  console.log(`x402 QDay a l ecoute sur ${PORT} — reseau ${NETWORK} — marchand ${MERCHANT}`);
  console.log(`facilitateur : ${FACILITATOR}`);
});
