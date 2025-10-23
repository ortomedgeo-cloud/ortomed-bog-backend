// api/index.js
import fetch from "node-fetch";

/**
 * Vercel направляет все запросы сюда (см. vercel.json).
 * Разрулим простейший роутинг по req.url.
 *
 * ЭНВ-ПЕРЕМЕННЫЕ, которые зададим в Vercel:
 *  - BOG_CLIENT_ID
 *  - BOG_CLIENT_SECRET
 *  - PUBLIC_BASE_URL      (например: https://ortomed-bog-backend.vercel.app)
 *  - SUCCESS_URL          (https://ortomed-geo.com/payment-success)
 *  - FAIL_URL             (https://ortomed-geo.com/payment-fail)
 */

const OAUTH_URL =
  "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token";
const CREATE_ORDER_URL =
  "https://api.bog.ge/payments/v1/ecommerce/orders";

// Вспомогательное: читаем сырое тело (нужно для колбэка)
async function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Простой UUIDv4 (для Idempotency-Key)
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Получить OAuth2 access_token
async function getAccessToken() {
  const basic = Buffer.from(
    ${process.env.BOG_CLIENT_ID}:${process.env.BOG_CLIENT_SECRET}
  ).toString("base64");

  const resp = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: Basic ${basic},
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(OAuth error: ${resp.status} ${JSON.stringify(data)});
  }
  return data.access_token;
}

export default async function handler(req, res) {
  try {
    // Уберём querystring, оставим путь
    const pathname = (req.url || "").split("?")[0];

    // CORS (на всякий)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    // -------------------------
    // 1) Создать заказ
    // POST /bog/create-order
    // -------------------------
    if (pathname === "/bog/create-order" && req.method === "POST") {
      let body = {};
      try {
        // Vercel парсит JSON сам; если придёт строка — подстрахуемся:
        if (typeof req.body === "string") body = JSON.parse(req.body);
        else body = req.body || {};
      } catch {
        body = {};
      }

      const {
        amount = 69.0,
        description = "Онлайн-диагностика осанки",
        product_id = "posture_diagnostics_online",
      } = body;

      const accessToken = await getAccessToken();

      const orderBody = {
        callback_url: ${process.env.PUBLIC_BASE_URL}/bog/callback,
        external_order_id: posture-${Date.now()},
        purchase_units: {
          currency: "GEL",
          total_amount: Number(amount),
          basket: [
            {
              quantity: 1,
              unit_price: Number(amount),
              product_id,
              description,
            },
          ],
        },
        redirect_urls: {
          success: process.env.SUCCESS_URL,
          fail: process.env.FAIL_URL,
        },
      };

      const orderResp = await fetch(CREATE_ORDER_URL, {
        method: "POST",
        headers: {
          Authorization: Bearer ${accessToken},
          "Content-Type": "application/json",
          "Idempotency-Key": uuidv4(),
        },
        body: JSON.stringify(orderBody),
      });

      const orderData = await orderResp.json();
      if (!orderResp.ok) {
        return res.status(400).json({ step: "create-order", orderData });
      }

      const redirect = orderData?._links?.redirect?.href;
      return res
        .status(200)
        .json({ order_id: orderData.id, redirect, status: orderData.status });
    }

    // -------------------------
    // 2) Callback банка
    // POST /bog/callback
    // -------------------------
    if (pathname === "/bog/callback" && req.method === "POST") {
      const raw = await readRaw(req);
      let payload = {};
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        // оставим как есть
      }

      // Здесь можно: проверить подпись (если банк присылает),
      // сохранить payload в БД/таблицу/почту и т.п.
      console.log("BOG CALLBACK:", JSON.stringify(payload));

      // Банку важно получить 200 OK
      return res.status(200).json({ ok: true });
    }

    // -------------------------
    // 3) Health-check / корень
    // GET /
    // -------------------------
    if (pathname === "/" && req.method === "GET") {
      return res
        .status(200)
        .json({ ok: true, service: "ortomed-bog-backend", time: Date.now() });
    }

    // Если не совпало ни с одним маршрутом
    return res.status(404).json({ error: "Not found" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
