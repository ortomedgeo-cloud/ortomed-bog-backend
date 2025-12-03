// app/api/payment.js
import { randomUUID } from 'crypto';

export const config = {
  api: { bodyParser: false },
};

const OAUTH_URL = 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const CREATE_ORDER_URL = 'https://api.bog.ge/payments/v1/ecommerce/orders';

const Service = {
  ZDOROVAYA_OSANKA_STOPY: 'ZDOROVAYA_OSANKA_STOPY',
  ANTIVALGUS: 'ANTIVALGUS',
  ANTISUTULOST: 'ANTISUTULOST',
  NORMAL_OSANKA: 'NORMAL_OSANKA',
  SUTULAYA: 'SUTULAYA',
  PLOSKAYA: 'PLOSKAYA',
  KRUGLO_VOGNUTAYA: 'KRUGLO_VOGNUTAYA',
  PLOSKO_VOGNUTAYA: 'PLOSKO_VOGNUTAYA',
};

const SUCCESS_URLS = {
  [Service.ZDOROVAYA_OSANKA_STOPY]: 'https://ortomed-geo.com/members/signup/group/l0tndutrrmtintu-zdorovaa-osanka-i-stopy',
  [Service.ANTIVALGUS]:               'https://ortomed-geo.com/members/signup/group/ste0q2t0neqvqxj-antivalgus',
  [Service.ANTISUTULOST]:             'https://ortomed-geo.com/members/signup/group/szljcghwsda1net-antisutulost',
  [Service.NORMAL_OSANKA]:            'https://ortomed-geo.com/members/signup/group/sjm5s1q2znpqwnj-normalnaa-osanka',
  [Service.SUTULAYA]:                 'https://ortomed-geo.com/members/signup/group/yk1tcxprtxllr0s-sutulaa-kruglaa-osanka',
  [Service.PLOSKAYA]:                 'https://ortomed-geo.com/members/signup/group/qxaxbum0rhcydnf-ploskaa-osanka',
  [Service.KRUGLO_VOGNUTAYA]:         'https://ortomed-geo.com/members/signup/group/evfamzjjl1vdsyt-kruglovognutaa-osanka',
  [Service.PLOSKO_VOGNUTAYA]:         'https://ortomed-geo.com/members/signup/group/ehvtn1vmuwtqdge-ploskovognutaa-osanka',
};

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept-Language');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Location')

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let amount, product_id; successUrl;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const name = url.searchParams.get('service');

    switch (name) {
      case Service.ZDOROVAYA_OSANKA_STOPY:
        product_id = Service.ZDOROVAYA_OSANKA_STOPY;
        amount = 1;
        break;
      case Service.ANTIVALGUS:
        product_id = Service.ANTIVALGUS;
        amount = 1;
        break;
      case Service.ANTISUTULOST:
        product_id = Service.ANTISUTULOST;
        amount = 1;
        break;
      case Service.NORMAL_OSANKA:
        product_id = Service.NORMAL_OSANKA;
        amount = 1;
        break;
      case Service.SUTULAYA:
        product_id = Service.SUTULAYA;
        amount = 1;
        break;
      case Service.PLOSKAYA:
        product_id = Service.PLOSKAYA;
        amount = 1;
        break;
      case Service.KRUGLO_VOGNUTAYA:
        product_id = Service.KRUGLO_VOGNUTAYA;
        amount = 1;
        break;
      case Service.PLOSKO_VOGNUTAYA:
        product_id = Service.PLOSKO_VOGNUTAYA;
        amount = 1;
        break;  
      default:
        return res.status(400).json({ error: 'Invalid service' });
    }
    
    successUrl = SUCCESS_URLS[name];
if (!successUrl) {
  return res.status(500).json({ error: 'Success URL not configured for this service' });
}

const failUrl = process.env.FAIL_URL || 'https://www.ortomed-geo.com/payment-fail';
    const price = amount;

    // const body = await readJsonBody(req);

    const rawLang = String(req.headers['accept-language'] || '').toLowerCase();
    const lang = rawLang.includes('en')
      ? 'en'
      : rawLang.includes('ru')
      ? 'ru'
      : 'ka';

    const basic = Buffer.from(
      `${process.env.BOG_CLIENT_ID}:${process.env.BOG_CLIENT_SECRET}`
    ).toString('base64');

    const tokenResp = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    const tokenRaw = await tokenResp.text();
    let tokenData;
    try {
      tokenData = JSON.parse(tokenRaw);
    } catch {
      tokenData = { raw: tokenRaw };
    }

    const accessToken = tokenData?.access_token;
    if (!tokenResp.ok || !accessToken) {
      return res.status(500).json({ error: 'Failed to get token', details: tokenData });
    }

    // const callbackUrl = process.env.PUBLIC_BASE_URL + '/api/callback';
    // const successUrl = process.env.SUCCESS_URL || 'https://www.ortomed-geo.com/success';
    // const failUrl = process.env.FAIL_URL || 'https://www.ortomed-geo.com/fail';

    const orderBody = {
  callback_url: process.env.BOG_CALLBACK_URL || 'https://www.ortomed-geo.com/bog-callback',
  redirect_urls: {
    success: successUrl,
    fail: failUrl,
  },
  purchase_units: {
    currency: 'GEL',
    total_amount: amount,
    basket: [
      {
        quantity: 1,
        unit_price: price,
        product_id,
      },
    ],
  },
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

    const orderRaw = await orderResp.text();
    let orderData;
    try {
      orderData = JSON.parse(orderRaw);
    } catch {
      orderData = { raw: orderRaw };
    }

    if (!orderResp.ok) {
      return res
        .status(orderResp.status || 400)
        .json({ step: 'create-order', bog: orderData });
    }

    const redirect =
      orderData?._links?.redirect?.href ||
      orderData?.redirect_url ||
      null;

    if (!redirect) {
      return res.status(400).json({ error: 'Redirect URL missing', orderData });
    }

    return res.status(303).setHeader('Location', redirect).json({
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
