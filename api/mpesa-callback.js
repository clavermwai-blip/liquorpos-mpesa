import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (req.query.token !== process.env.MPESA_CALLBACK_SECRET) {
    console.warn('Invalid callback token');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const callbackData = req.body?.Body?.stkCallback;
  if (!callbackData) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callbackData;

  try {
    if (ResultCode === 0) {
      const items = CallbackMetadata?.Item || [];
      const amount  = items.find(i => i.Name === 'Amount')?.Value;
      const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const phone   = items.find(i => i.Name === 'PhoneNumber')?.Value;

      const subRef = db.doc('subscriptions/main');
      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      await db.runTransaction(async (t) => {
        const doc = await t.get(subRef);
        const currentPaidUntil = doc.data()?.paidUntil || 0;
        const newPaidUntil = Math.max(now, currentPaidUntil) + thirtyDays;
        t.set(subRef, {
          paidUntil: newPaidUntil,
          lastPaymentReceipt: receipt,
          lastPaymentAmount: amount,
          lastPaymentPhone: phone,
          updatedAt: now
        }, { merge: true });
      });

      await db.collection('payments').add({
        CheckoutRequestID, amount, receipt, phone,
        status: 'success', createdAt: now
      });

      console.log(`✅ Payment success: ${receipt} for ${amount} KES`);
    } else {
      await db.collection('payments').add({
        CheckoutRequestID,
        status: 'failed',
        ResultCode, ResultDesc,
        createdAt: Date.now()
      });
      console.log(`❌ Payment failed: ${ResultDesc}`);
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'OK' });
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Processed with errors' });
  }
}