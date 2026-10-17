import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { phone, amount, accountRef } = req.body || {};

  if (!/^254[17]\d{8}$/.test(phone)) {
    return res.status(400).json({ ok: false, error: 'Invalid phone. Use 2547XXXXXXXX' });
  }
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid amount' });
  }

  const {
    DARAJA_CONSUMER_KEY,
    DARAJA_CONSUMER_SECRET,
    DARAJA_SHORTCODE,
    DARAJA_PASSKEY,
    MPESA_CALLBACK_SECRET,
    DARAJA_ENV
  } = process.env;

  const base = DARAJA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

  const callbackUrl = `https://${req.headers.host}/api/mpesa-callback?token=${MPESA_CALLBACK_SECRET}`;

  try {
    const auth = Buffer.from(`${DARAJA_CONSUMER_KEY}:${DARAJA_CONSUMER_SECRET}`).toString('base64');
    const tokenRes = await axios.get(
      `${base}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const accessToken = tokenRes.data.access_token;

    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${DARAJA_SHORTCODE}${DARAJA_PASSKEY}${timestamp}`).toString('base64');

    const stkPayload = {
      BusinessShortCode: DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: process.env.DARAJA_TXN_TYPE || 'CustomerPayBillOnline',
      Amount: Math.ceil(Number(amount)),
      PartyA: phone,
      PartyB: DARAJA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: (accountRef || 'LIQUORPOS').slice(0, 12),
      TransactionDesc: 'Subscription Payment'
    };

    const stkRes = await axios.post(
      `${base}/mpesa/stkpush/v1/processrequest`,
      stkPayload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return res.status(200).json({
      ok: true,
      CheckoutRequestID: stkRes.data.CheckoutRequestID,
      CustomerMessage: stkRes.data.CustomerMessage
    });
  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: error.response?.data?.errorMessage || 'Failed to initiate payment'
    });
  }
}