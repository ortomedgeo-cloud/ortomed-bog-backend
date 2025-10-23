// api/payment.js
import { randomUUID } from 'crypto';

export const config = {
  api: { bodyParser: false }, // отключаем авто-парсер Next.js
};

const OAUTH_URL = 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const CREATE_ORDER_URL = 'https://api.bog.ge/payments/v1/ecommerce/orders';

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
    // --- Разбор тела запроса (теперь всегда безопасно) ---
    const body = await readJsonBody(req);

    const amount = Number(body.amount ?? 1);
    const description = body.description || 'Оплата услуг';
    const product_id = body.product_id || 'posture_diagnostics_online';

    // Язык из Accept-Language (по умолчанию ka)
    const rawLang = String(req.headers['accept-language'] || '').toLowerCase();
    const lang = rawLang.includes('en') ? 'en' : (rawLang.includes('ru') ? 'ru' : 'ka');

    // --- OAuth: получаем токен (x-www-form-urlencoded) ---
    const basic = Buffer
      .from(`${process.env.BOG_CLIENT_ID}:${process.env.BOG_CLIENT_SECRET}`)
      .toString('base64');

    const tokenResp = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    const tokenData = await tokenResp.json().catch(() => ({}));
    const accessToken = tokenData?.access_token;

    if (!tokenResp.ok || !accessToken) {
      return res.status(500).json({ error: 'Failed to get token', details: tokenData });
    }

    // --- Создаём заказ (JSON) ---
 const callbackUrl = process.env.CALLBACK_URL || `${process.env.PUBLIC_BASE_URL || ''}/api/callback`;

const orderBody = {
  callback_url: callbackUrl || '',
  redirect_urls: {
    success: process.env.SUCCESS_URL,
    fail: process.env.FAIL_URL,
  },
  purchase_units: [
    {
      currency: 'GEL',
      total_amount: Number.isFinite(amount) ? amount : 1,
      basket: [{
        quantity: 1,
        unit_price: Number.isFinite(amount) ? amount : 1,
        product_id,
        description,
      }],
    },
  ],
};


    const orderResp = await fetch(CREATE_ORDER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept-Language': lang,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(orderBody),
    });

    // иногда BOG возвращает текст при ошибке — читаем как text и пытаемся распарсить
    const raw = await orderResp.text();
    let orderData;
    try { orderData = JSON.parse(raw); } catch { orderData = { raw }; }

    if (!orderResp.ok) {
      console.error('BOG create-order failed:', orderResp.status, orderData);
      return res.status(orderResp.status || 400).json({ step: 'create-order', bog: orderData });
    }

    const redirect =
      orderData?._links?.redirect?.href ||
      orderData?.redirect_url ||
      null;

    if (!redirect) {
      return res.status(400).json({ error: 'Redirect URL missing', orderData });
    }

    return res.status(303).json({
      payment_url: redirect,
      redirect_url: redirect,
      order_id: orderData.id,
      status: orderData.status || 'created',
      lang,
    }).setHeader('Location', redirect);

  } catch (e) {
    console.error('Payment error:', e);
    return res.status(500).json({ error: 'Payment failed', detail: String(e) });
  }
}
