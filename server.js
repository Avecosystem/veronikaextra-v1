import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) {
        const key = m[1];
        let val = m[2];
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith('\'') && val.endsWith('\'')) val = val.slice(1, -1);
        if (!(key in process.env)) process.env[key] = val;
      }
    });
  }
} catch { }

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, numberOfImages } = req.body || {};
    const nRaw = Number(numberOfImages);
    const n = Math.min(Math.max(isNaN(nRaw) ? 1 : nRaw, 1), 6);

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'Invalid prompt' });
    }

    const apiKey = process.env.A4F_API_KEY;
    const model = process.env.A4F_MODEL || 'provider-4/imagen-3.5';
    let baseUrl = process.env.A4F_BASE_URL || 'https://api.a4f.co/v1/images/generations';
    if (baseUrl.includes('api.a4f.ai')) {
      baseUrl = baseUrl.replace('api.a4f.ai', 'api.a4f.co');
    }
    if (baseUrl.endsWith('/images/generate')) {
      baseUrl = baseUrl.replace('/images/generate', '/images/generations');
    }

    if (!apiKey) {
      console.error('A4F_API_KEY missing');
      return res.status(500).json({ message: 'Missing A4F_API_KEY' });
    }

    const makePayload = (count) => ({
      model,
      prompt,
      num_images: count,
      size: '1024x1024'
    });

    console.log(`[Generate] Requesting ${n} images from ${baseUrl}`);

    const r = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(makePayload(1))
    });

    const contentType = r.headers.get('content-type') || '';
    let data = null;

    // Always try to get text first to log it if JSON parse fails
    const rawText = await r.text();

    try {
      if (contentType.includes('application/json')) {
        data = JSON.parse(rawText);
      }
    } catch (e) {
      console.error('[Generate] Failed to parse JSON response:', rawText.substring(0, 200));
    }

    if (!r.ok) {
      const msg = (data && (data.message || data.error || data.detail || data.reason)) || 'Image provider error';
      console.error('[Generate] Provider error:', { status: r.status, data: data || rawText });
      return res.status(r.status).json({ message: msg, debug: { status: r.status, rawResponse: rawText.substring(0, 500) } });
    }

    if (!data || (typeof data !== 'object')) {
      // Fallback if content-type wasn't json but status was 200 (unlikely but possible)
      console.error('[Generate] Malformed response (not object):', rawText.substring(0, 200));
      return res.status(500).json({ message: 'Malformed provider response', raw: rawText.substring(0, 200) });
    }

    let images = [];
    const fromImages = Array.isArray(data.images) ? data.images : [];
    const fromData = Array.isArray(data.data) ? data.data : [];

    if (fromImages.length) {
      images = fromImages.map((img) => {
        if (typeof img === 'string') return { url: img };
        if (img && typeof img.url === 'string') return { url: img.url };
        if (img && typeof img.base64 === 'string') return { url: `data:image/png;base64,${img.base64}` };
        if (img && typeof img.b64 === 'string') return { url: `data:image/png;base64,${img.b64}` };
        return null;
      }).filter(Boolean);
    } else if (fromData.length) {
      images = fromData.map((d) => {
        if (d && typeof d.url === 'string') return { url: d.url };
        if (d && typeof d.b64_json === 'string') return { url: `data:image/png;base64,${d.b64_json}` };
        return null;
      }).filter(Boolean);
    }

    console.log(`[Generate] Success, Got ${images.length} images`);

    // Retry logic if we didn't get enough images
    const seen = new Set();
    images = images.filter((img) => {
      if (!img || typeof img.url !== 'string') return false;
      if (seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    });

    let attempts = 0;
    const maxAttempts = Math.min(n * 3, 12);
    while (images.length < n && attempts < maxAttempts) {
      attempts++;
      console.log(`[Generate] Retry attempt ${attempts} to add single image`);
      try {
        const r2 = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(makePayload(1))
        });

        const rawText2 = await r2.text();
        let d2 = null;
        try { d2 = JSON.parse(rawText2); } catch { }

        if (!r2.ok) {
          console.warn(`[Generate] Retry failed: ${r2.status}`);
          break;
        }

        const imgs2 = d2 ? (Array.isArray(d2.images) ? d2.images : Array.isArray(d2.data) ? d2.data : []) : [];
        const mapped = imgs2.map((img) => {
          if (typeof img === 'string') return { url: img };
          if (img && typeof img.url === 'string') return { url: img.url };
          if (img && typeof img.base64 === 'string') return { url: `data:image/png;base64,${img.base64}` };
          if (img && typeof img.b64_json === 'string') return { url: `data:image/png;base64,${img.b64_json}` };
          if (img && typeof img.b64 === 'string') return { url: `data:image/png;base64,${img.b64}` };
          return null;
        }).filter(Boolean);

        for (const m of mapped) {
          if (m && typeof m.url === 'string' && !seen.has(m.url)) {
            seen.add(m.url);
            images.push(m);
            if (images.length >= n) break;
          }
        }
      } catch (e) {
        console.error('[Generate] Retry error:', e);
        break;
      }
    }

    if (images.length < n) {
      if (images.length > 0) {
        const original = images.slice();
        console.warn(`[Generate] Fallback duplicating to reach ${n}. Original unique count: ${original.length}`);
        let idx = original.length - 1;
        while (images.length < n) {
          if (idx < 0) idx = original.length - 1;
          images.push({ url: original[idx].url });
          idx--;
        }
      } else {
        console.error('[Generate] No images produced by provider');
        return res.status(502).json({ message: 'Image provider returned no images' });
      }
    }

    return res.status(200).json({ success: true, images });
  } catch (error) {
    console.error('[Generate] API error:', error);
    const msg = (error && error.message) ? error.message : 'Internal Server Error';
    return res.status(500).json({ message: msg });
  }
});

// Cashfree create order
app.post('/api/cashfree', async (req, res) => {
  try {
    const { orderId, amount, customerPhone, customerName, customerEmail, returnUrl } = req.body || {};
    if (!orderId || !amount || !customerName) {
      return res.status(400).json({ message: 'Missing required fields for Cashfree payment.' });
    }
    const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
    const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
    if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
      return res.status(500).json({ message: 'Cashfree credentials missing' });
    }
    const customer_phone = (typeof customerPhone === 'string' && customerPhone.trim()) ? customerPhone.trim() : '9999999999';

    const payload = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: (String(orderId).split('-')[0]) || 'guest',
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone
      },
      order_meta: {
        return_url: returnUrl
      }
    };

    const r = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version': '2022-09-01'
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (r.ok && data.payment_link) {
      return res.status(200).json({ success: true, paymentLink: data.payment_link, paymentSessionId: data.payment_session_id });
    }
    console.error('Cashfree API Error:', data);
    return res.status(400).json({ success: false, message: data.message || 'Failed to initiate Cashfree payment' });
  } catch (e) {
    console.error('Cashfree endpoint error:', e);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Cashfree verify order
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ message: 'Missing orderId' });
    const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
    const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
    if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
      return res.status(500).json({ message: 'Cashfree credentials missing' });
    }
    const r = await fetch(`https://api.cashfree.com/pg/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version': '2022-09-01'
      }
    });
    const data = await r.json();
    if (r.ok) {
      return res.status(200).json({ success: true, status: data.order_status });
    }
    return res.status(400).json({ success: false, message: data.message || 'Failed to verify payment' });
  } catch (e) {
    console.error('Verify payment endpoint error:', e);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Oxapay create invoice
app.post('/api/oxapay', async (req, res) => {
  try {
    const { amount, orderId, email, description, returnUrl } = req.body || {};
    if (!amount || !orderId) return res.status(400).json({ message: 'Missing required fields for Oxapay.' });
    const merchant = process.env.OXPAY_MERCHANT_ID || 'QB5WB5-GAS15X-IBUGYW-SNGIRG';
    const payload = {
      merchant,
      amount,
      currency: 'USD',
      lifeTime: 30,
      feePaidByPayer: 0,
      underPaidCover: 0,
      returnUrl,
      description,
      orderId,
      email
    };
    const r = await fetch('https://api.oxapay.com/merchants/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (data.result === 100 && data.payLink) {
      return res.status(200).json({ success: true, paymentUrl: data.payLink });
    }
    console.error('Oxapay API Error:', data);
    return res.status(400).json({ success: false, message: data.message || 'Failed to create crypto invoice' });
  } catch (e) {
    console.error('Oxapay endpoint error:', e);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Proxy image to avoid CORS tainting when drawing to canvas
app.get('/api/proxy-image', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ message: 'Missing url' });
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ message: 'Invalid url' });
    }
    if (parsed.protocol !== 'https:' || (parsed.hostname !== 'api.a4f.co' && parsed.hostname !== 'a4f.co')) {
      return res.status(400).json({ message: 'Forbidden host' });
    }
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(r.status).json({ message: 'Upstream image error' });
    }
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', ct);
    res.send(buf);
  } catch (e) {
    console.error('Proxy image error:', e);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
