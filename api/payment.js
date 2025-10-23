// /api/payment.js
// Создаёт заказ в BOG и возвращает ссылку на оплату
export const config = { runtime: 'nodejs' };

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getAccessToken() {
  const OAUTH_URL = 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token';

  const basic = Buffer.from(
    ${process.env.BOG_CLIENT_ID}:${process.env.BOG_CLIENT_SECRET}
  ).toString('base64');

  const resp = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': Basic ${basic},
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(OAuth error: ${resp.status} ${JSON.stringify(data)});
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept-Language,x-language');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {}

    const {
      amount = 69.0,
      description = 'онлайн-диагностика осанки',
      product_id = 'posture_diagnostics_online',
      language: languageFromBody,
    } = body;

    const fromHeader = (req.headers['x-language'] || req.headers['accept-language'] || '').toString().toLowerCase();
    let lang = (languageFromBody || fromHeader || 'ka').slice(0, 2);
    if (!['ka', 'en'].includes(lang)) lang = 'ka';

    const accessToken = await getAccessToken();
    const CREATE_ORDER_URL = 'https://api.bog.ge/payments/v1/ecommerce/orders';

    const orderBody = {
      callback_url: ${process.env.PUBLIC_BASE_URL}/api/bog/callback,
      external_order_id: posture-${Date.now()},
      purchase_units: {
        currency: 'GEL',
        total_amount: Number(amount),
        basket: [{ quantity: 1, unit_price: Number(amount), product_id, description }],
      },
      redirect_urls: {
        success: process.env.SUCCESS_URL,
        fail: process.env.FAIL_URL,
      },
    };

    const orderResp = await fetch(CREATE_ORDER_URL, {
      method: 'POST',
      headers: {
        'Authorization': Bearer ${accessToken},
        'Content-Type': 'application/json',
        'Idempotency-Key': uuidv4(),
        'x-language': lang,
        'Accept-Language': lang,
      },
      body: JSON.stringify(orderBody),
    });

    const orderData = await orderResp.json();

    if (!orderResp.ok) {
      return res.status(400).json({ step: 'create-order', orderData });
    }

    const redirect = orderData?._links?.redirect?.href || orderData?.redirect_url || null;

    return res.status(200).json({
      order_id: orderData.id,
      status: orderData.status,
      redirect_url: redirect,
      lang,
    });
  } catch (e) {
    console.error('Payment error:', e);
    return res.status(500).json({ error: 'Payment failed', detail: String(e) });
  }
}
