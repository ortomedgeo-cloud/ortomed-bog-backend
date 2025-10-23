// api/payment.js
import { randomUUID } from 'crypto';

/**
 * ВАЖНО: отключаем автопарсер Next.js, чтобы читать body вручную.
 * Это избавит от "Invalid JSON" на Vercel.
 */
export const config = {
  api: { bodyParser: false },
};

const OAUTH_URL = 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const CREATE_ORDER_URL = 'https://api.bog.ge/payments/v1/ecommerce/orders';

/** Простой помощник для чтения "сырого" тела запроса */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
  // --- CORS / preflight ---
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept-Language');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // --- Разбор тела запроса ---
    const body = await readJsonBody(req);
    const amountRaw = Number(body.amount ?? 1);
    const description = body.description || 'Оплата услуг';
    const product_id = body.product_id || 'posture_diagnostics_online';

    // Нормализуем сумму (минимум 1.00)
    const amt = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 1;
    // если API требует десятичную строку — можно использовать amountStr
    const amount = Number(amt.toFixed(2));

    // Язык из Accept-Language (по умолчанию ka)
    const rawLang = String(req.headers['accept-language'] || '').toLowerCase();
    const lang = rawLang.includes('en') ? 'en' : (rawLang.includes('ru') ? 'ru' : 'ka');

    // --- OAuth: получаем токен ---
    const basic = Buffer
      .from(${process.env.BOG_CLIENT_ID}:${process.env.BOG_CLIENT_SECRET})
      .toString('base64');

    const tokenResp = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': Basic ${basic},
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    // Иногда при ошибке возвращают не-JSON → читаем текстом и пробуем распарсить
    const tokenRaw = await tokenResp.text();
    let tokenData;
    try { tokenData = JSON.parse(tokenRaw); } catch { tokenData = { raw: tokenRaw }; }
    const accessToken = tokenData?.access_token;

    if (!tokenResp.ok || !accessToken) {
      return res.status(500).json({ error: 'Failed to get token', details: tokenData });
    }

    // --- Создаём заказ ---
    // Если в твоём кабинете обязательны redirect-URL — возьми из ENV
    const callbackUrl = process.env.CALLBACK_URL || ''; // оставь пусто, если необязателен
    const successUrl = process.env.SUCCESS_URL || 'https://www.ortomed-geo.com/success';
    const failUrl = process.env.FAIL_URL || 'https://www.ortomed-geo.com/fail';

    const orderBody = {
      callback_url: callbackUrl || undefined, // если пусто — ключ не уйдёт в JSON
      redirect_urls: {
        success: successUrl,
        fail: failUrl,
      },
      purchase_units: [
        {
          currency: 'GEL',
          total_amount: amount, // число; если у них строго строка с 2 знаками — замени на amt.toFixed(2)
          basket: [
            {
              quantity: 1,
              unit_price: amount,
              product_id,
              description,
            },
          ],
        },
      ],
    };

    const orderResp = await fetch(CREATE_ORDER_URL, {
      method: 'POST',
      headers: {
        'Authorization': Bearer ${accessToken},
        'Content-Type': 'application/json',
        'Accept-Language': lang,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(orderBody),
    });

    // иногда BOG при ошибке отдаёт текст → читаем text() и пытаемся распарсить
    const orderRaw = await orderResp.text();
    let orderData;
    try { orderData = JSON.parse(orderRaw); } catch { orderData = { raw: orderRaw }; }

    if (!orderResp.ok) {
      // типичный ответ 400 { message: 'Error description...' }
      return res.status(orderResp.status || 400).json({ step: 'create-order', bog: orderData });
    }

    // Ищем ссылку на редирект
    const redirect =
      orderData?._links?.redirect?.href ||
      orderData?.redirect_url ||
      null;

    if (!redirect) {
      return res.status(400).json({ error: 'Redirect URL missing', orderData });
    }

    // --- Ответ фронту / Tilda ---
    return res.status(200).json({
      payment_url: redirect,
      redirect_url: redirect,
      order_id: orderData.id,
      status: orderData.status || 'created',
      lang,
    });

  } catch (e) {
    console.error('Payment error:', e);
    return res.status(500).json({ error: 'Payment failed', detail: String(e) });
  }
}
