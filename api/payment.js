// /api/payment.js
// Создаёт заказ в BOG и возвращает ссылку на оплату

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getAccessToken() {
  // правильный OAuth-эндпоинт BOG
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
  if (!resp.ok) throw new Error(`OAuth error: ${resp.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

export default async function handler(req, res) {
  // CORS (на всякий случай, если дергать с Тильды)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Парсим тело запроса
    let body = {};
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch {}
    const {
      amount = 69.0,
      description = "Онлайн-диагностика осанки",
      product_id = "posture_diagnostics_online",
    } = body;

    const accessToken = await getAccessToken();

    // правильный эндпоинт создания заказа
    const CREATE_ORDER_URL = "https://api.bog.ge/payments/v1/ecommerce/orders";

    const orderBody = {
      callback_url: `${process.env.PUBLIC_BASE_URL}/api/bog/callback`, // можно пока не создавать, банку важен 200 OK
      external_order_id: `posture-${Date.now()}`,
      purchase_units: {
        currency: "GEL",
        total_amount: Number(amount),
        basket: [
          { quantity: 1, unit_price: Number(amount), product_id, description }
        ]
      },
      redirect_urls: {
        success: process.env.SUCCESS_URL,
        fail: process.env.FAIL_URL
      }
    };

    const orderResp = await fetch(CREATE_ORDER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": uuidv4(),
      },
      body: JSON.stringify(orderBody),
    });

    const orderData = await orderResp.json();
    if (!orderResp.ok) {
      return res.status(400).json({ step: "create-order", orderData });
    }

    // в ответе BOG обычно есть ссылка редиректа
    const redirect = orderData?._links?.redirect?.href || orderData?.redirect_url;
    return res.status(200).json({
      order_id: orderData.id,
      status: orderData.status,
      redirect,
    });
  } catch (e) {
    console.error("Payment error:", e);
    return res.status(500).json({ error: "Payment failed", detail: String(e) });
  }
}
