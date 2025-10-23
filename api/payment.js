export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    amount,
    description = "Payment for orthomed-geo service",
  } = req.body;

  try {
    const authResponse = await fetch("https://oauth.bog.ge/auth/realms/bog/protocol/openid-connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.BOG_CLIENT_ID,
        client_secret: process.env.BOG_CLIENT_SECRET,
      }),
    });

    const authData = await authResponse.json();

    if (!authData.access_token) {
      throw new Error("Failed to get access token");
    }

    const orderResponse = await fetch("https://api.bog.ge/payments/v1/ecommerce/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: Bearer ${authData.access_token},
      },
      body: JSON.stringify({
        amount,
        currency: "GEL",
        description,
        callbackUrl: ${process.env.PUBLIC_BASE_URL}/api/payment,
        returnUrl: process.env.SUCCESS_URL,
        failUrl: process.env.FAIL_URL,
      }),
    });

    const orderData = await orderResponse.json();

    return res.status(200).json(orderData);
  } catch (error) {
    console.error("Payment error:", error);
    return res.status(500).json({ error: "Payment failed", details: error.message });
  }
}
