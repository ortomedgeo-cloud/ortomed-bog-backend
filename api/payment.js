// /api/payment.js
// Создаёт заказ в BOG и возвращает ссылку на оплату
// Гарантируем Node.js runtime, а не Edge
export const config = { runtime: 'nodejs' };

if (!process.env.BOG_CLIENT_ID || !process.env.BOG_CLIENT_SECRET) {
  console.error('Missing BOG env vars');
}

// Простенький генератор idempotency-key
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getAccessToken() {
  // OAuth-эндпоинт BOG
  const OAUTH_URL = "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token";

  const basic = Buffer.from(
    `${process.env.BOG_CLIENT_ID}:${process.env.BOG_CLIENT_SECRET}`
  ).toString("base64");

  const resp = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`OAuth error: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

export default async function handler(req, res) {
  // Разрешим CORS на всякий случай
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept-Language,x-language");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // --- Разбираем входные данные ---
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {}

    const {
      amount = 1.0,
      description = "онлайн-диагностика осанки",
      product_id = "posture_diagnostics_online",
      language: languageFromBody, // необязательное поле
    } = body;

    // Язык берём в приоритете из заголовка, затем из body, по умолчанию — "ka"
    const fromHeader =
      (req.headers["x-language"] || req.headers["accept-language"] || "").toString().toLowerCase();
    let lang = (languageFromBody || fromHeader || "ka").slice(0, 2);
    if (!["ka", "en"].includes(lang)) lang = "ka"; // банк принимает только ka или en

    const accessToken = await getAccessToken();

    // --- Создание заказа ---
    const CREATE_ORDER_URL = "https://api.bog.ge/payments/v1/ecommerce/orders";

    const orderBody = {
      callback_url: `${process.env.PUBLIC_BASE_URL}/api/bog/callback`,
      external_order_id: `posture-${Date.now()}`,
      purchase_units: {
        currency: "GEL",
        total_amount: Number(amount),
        basket: [{ quantity: 1, unit_price: Number(amount), product_id, description }],
      },
      redirect_urls: {
        success: process.env.SUCCESS_URL,
        fail: process.env.FAIL_URL,
      },
    };

    const orderResp = await fetch(CREATE_ORDER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": uuidv4(),
        // язык — и в x-language, и в Accept-Language
        "x-language": lang,
        "Accept-Language": lang,
      },
      body: JSON.stringify(orderBody),
    });

 // ...весь твой код выше...
// авторизация, получение токена, создание заказа и т.д.

const orderData = await orderResp.json();

// ⬇️ ВСТАВЛЯЕШЬ СЮДА вот этот блок (и после него — ничего больше)
if (req.method === 'OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(200).end();
}
res.setHeader('Access-Control-Allow-Origin', '*');

const redirect = orderData?._links?.redirect?.href || orderData?.redirect_url || null;

if (!redirect) {
  return res.status(400).json({ error: 'Redirect URL missing', orderData });
}

return res.status(200).json({
  payment_url: redirect,
  redirect_url: redirect,
  order_id: orderData.id,
  status: orderData.status || 'created'
});

// 👇 вот это — конец функции
} catch (e) {
  console.error("Payment error:", e);
  return res.status(500).json({ error: "Payment failed", detail: String(e) });
}

