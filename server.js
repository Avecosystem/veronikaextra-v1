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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Centralized in-memory store for deployed environments
const STORE = {
  users: [],
  sessions: {},
  paymentRequests: [],
  cryptoTransactions: [],
  nextUserId: 1,
  nextPaymentRequestId: 1,
  nextCryptoTransactionId: 1,
  globalNotice: '',
  creditsPageNotice: '',
  creditPlans: [
    { id: 1, credits: 50, inrPrice: 149, usdPrice: +(149/83).toFixed(2) },
    { id: 2, credits: 100, inrPrice: 229, usdPrice: +(229/83).toFixed(2) },
    { id: 3, credits: 200, inrPrice: 299, usdPrice: +(299/83).toFixed(2) },
    { id: 4, credits: 500, inrPrice: 349, usdPrice: +(349/83).toFixed(2) },
    { id: 5, credits: 1000, inrPrice: 499, usdPrice: +(499/83).toFixed(2) },
  ],
  contactInfo: { email1: 'infobabe09@gmail.com', email2: '', location: '', phone: '', note: '' },
  socialLinks: { instagram: '', twitter: '', website: '', general: '' },
  legalContent: { terms: '', privacy: '' },
  claimedDeviceIds: [],
  exchangeRate: 83
};

const IMAGE_COST = 5;
const generateToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const getToken = (req) => {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.*)$/i);
  return m ? m[1] : null;
};
const getUserByToken = (req) => {
  const token = getToken(req);
  const uid = token ? STORE.sessions[token] : undefined;
  return typeof uid === 'number' ? STORE.users.find(u => u.id === uid) : undefined;
};
const isAdmin = (user) => !!(user && user.isAdmin);

// Initialize admin user
(() => {
  const adminEmail = 'ankanbayen@gmail.com';
  const existing = STORE.users.find(u => u.email === adminEmail);
  if (!existing) {
    STORE.users.push({ id: STORE.nextUserId++, name: 'Admin', email: adminEmail, passwordHash: 'Ankan@6295', credits: 999999, createdAt: new Date().toISOString(), isAdmin: true, country: 'India' });
  }
})();

// Auth endpoints
app.post('/api/register', (req, res) => {
  try {
    const { name, email, password, country, deviceId } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ message: 'Missing fields' });
    if (STORE.users.some(u => u.email === email)) return res.status(409).json({ message: 'Email already registered.' });
    let starting = 25;
    if (deviceId && STORE.claimedDeviceIds.includes(deviceId)) starting = 0; else if (deviceId) STORE.claimedDeviceIds.push(deviceId);
    const user = { id: STORE.nextUserId++, name, email, passwordHash: password, credits: starting, createdAt: new Date().toISOString(), isAdmin: false, country: country || 'India' };
    STORE.users.push(user);
    const token = generateToken();
    STORE.sessions[token] = user.id;
    const { passwordHash, ...profile } = user;
    return res.status(200).json({ success: true, token, data: profile });
  } catch (e) {
    console.error('Register error:', e);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = STORE.users.find(u => u.email === email && u.passwordHash === password);
    if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
    const token = generateToken();
    STORE.sessions[token] = user.id;
    const { passwordHash, ...profile } = user;
    return res.status(200).json({ success: true, token, data: profile });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.get('/api/profile', (req, res) => {
  const user = getUserByToken(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized.' });
  const { passwordHash, ...profile } = user;
  return res.status(200).json({ success: true, data: profile });
});

app.post('/api/logout', (req, res) => {
  const token = getToken(req);
  if (token) delete STORE.sessions[token];
  return res.status(200).json({ success: true });
});

// Admin: users
app.get('/api/admin/users', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  const users = STORE.users.map(u => { const { passwordHash, ...profile } = u; return profile; });
  return res.status(200).json({ success: true, data: users });
});

app.post('/api/admin/update-credits', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  const { userId, newCredits } = req.body || {};
  const u = STORE.users.find(x => x.id === Number(userId));
  if (!u) return res.status(404).json({ message: 'User not found.' });
  u.credits = Number(newCredits) || 0;
  const { passwordHash, ...profile } = u;
  return res.status(200).json({ success: true, data: profile });
});

app.delete('/api/admin/users/:id', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  const id = Number(req.params.id);
  const idx = STORE.users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ message: 'User not found.' });
  STORE.users.splice(idx, 1);
  Object.keys(STORE.sessions).forEach(k => { if (STORE.sessions[k] === id) delete STORE.sessions[k]; });
  return res.status(200).json({ success: true, data: { message: 'User deleted successfully.' } });
});

// Notices and configs
app.get('/api/global-notice', (req, res) => res.status(200).json({ success: true, data: STORE.globalNotice }));
app.post('/api/global-notice', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  STORE.globalNotice = (req.body && req.body.message) || '';
  return res.status(200).json({ success: true, data: STORE.globalNotice });
});

app.get('/api/credits-notice', (req, res) => res.status(200).json({ success: true, data: STORE.creditsPageNotice }));
app.post('/api/credits-notice', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  STORE.creditsPageNotice = (req.body && req.body.message) || '';
  return res.status(200).json({ success: true, data: STORE.creditsPageNotice });
});

app.get('/api/exchange-rate', (req, res) => res.status(200).json({ success: true, data: STORE.exchangeRate }));
app.post('/api/exchange-rate', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  const { rate } = req.body || {};
  STORE.exchangeRate = Number(rate) || STORE.exchangeRate;
  return res.status(200).json({ success: true, data: STORE.exchangeRate });
});

app.get('/api/contact-info', (req, res) => res.status(200).json({ success: true, data: STORE.contactInfo }));
app.post('/api/contact-info', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden' });
  STORE.contactInfo = req.body || STORE.contactInfo;
  return res.status(200).json({ success: true, data: STORE.contactInfo });
});

app.get('/api/social-links', (req, res) => res.status(200).json({ success: true, data: STORE.socialLinks }));
app.post('/api/social-links', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden' });
  STORE.socialLinks = req.body || STORE.socialLinks;
  return res.status(200).json({ success: true, data: STORE.socialLinks });
});

app.get('/api/legal-content', (req, res) => res.status(200).json({ success: true, data: STORE.legalContent }));
app.post('/api/legal-content', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden' });
  STORE.legalContent = req.body || STORE.legalContent;
  return res.status(200).json({ success: true, data: STORE.legalContent });
});

// Credit plans
app.get('/api/credit-plans', (req, res) => res.status(200).json({ success: true, data: STORE.creditPlans }));
app.get('/api/admin/credit-plans', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  return res.status(200).json({ success: true, data: STORE.creditPlans });
});
app.post('/api/admin/credit-plans/:id', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  const id = Number(req.params.id);
  const idx = STORE.creditPlans.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ message: 'Credit plan not found.' });
  const { credits, inrPrice, usdPrice } = req.body || {};
  STORE.creditPlans[idx] = {
    ...STORE.creditPlans[idx],
    credits: Number(credits) || STORE.creditPlans[idx].credits,
    inrPrice: Number(inrPrice) || STORE.creditPlans[idx].inrPrice,
    usdPrice: Number(usdPrice) || STORE.creditPlans[idx].usdPrice
  };
  return res.status(200).json({ success: true, data: STORE.creditPlans[idx] });
});

// User-specific lists
app.get('/api/user/payment-requests', (req, res) => {
  const me = getUserByToken(req);
  if (!me) return res.status(401).json({ message: 'Unauthorized.' });
  const list = STORE.paymentRequests.filter(r => r.userId === me.id);
  return res.status(200).json({ success: true, data: list });
});
app.get('/api/user/crypto-transactions', (req, res) => {
  const me = getUserByToken(req);
  if (!me) return res.status(401).json({ message: 'Unauthorized.' });
  const list = STORE.cryptoTransactions.filter(r => r.userId === me.id);
  return res.status(200).json({ success: true, data: list });
});

// Admin payment lists
app.get('/api/admin/payment-requests', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  return res.status(200).json({ success: true, data: STORE.paymentRequests });
});
app.get('/api/admin/crypto-transactions', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  return res.status(200).json({ success: true, data: STORE.cryptoTransactions });
});

// Admin manual actions for UPI payment requests
app.post('/api/admin/payment-requests/:id/approve', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  const id = Number(req.params.id);
  const idx = STORE.paymentRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ message: 'Payment request not found.' });
  const reqRec = STORE.paymentRequests[idx];
  if (reqRec.status !== 'pending') return res.status(400).json({ message: 'Payment request already processed.' });
  const uIndex = STORE.users.findIndex(u => u.id === reqRec.userId);
  if (uIndex === -1) return res.status(404).json({ message: 'User associated with request not found.' });
  let creditsToAdd = Number(reqRec.credits);
  if (!creditsToAdd || isNaN(creditsToAdd)) {
    const m = (reqRec.plan || '').match(/(\d+)\s*Credits/i);
    creditsToAdd = m ? parseInt(m[1], 10) : 0;
  }
  if (creditsToAdd > 0) {
    STORE.users[uIndex].credits = (STORE.users[uIndex].credits || 0) + creditsToAdd;
  }
  STORE.paymentRequests[idx].status = 'approved';
  return res.status(200).json({ success: true, data: { message: creditsToAdd > 0 ? `Payment request approved. ${creditsToAdd} credits added to user.` : 'Payment request approved.' } });
});

app.post('/api/admin/payment-requests/:id/reject', (req, res) => {
  const me = getUserByToken(req);
  if (!isAdmin(me)) return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  const id = Number(req.params.id);
  const idx = STORE.paymentRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ message: 'Payment request not found.' });
  const reqRec = STORE.paymentRequests[idx];
  if (reqRec.status !== 'pending') return res.status(400).json({ message: 'Payment request already processed.' });
  STORE.paymentRequests[idx].status = 'rejected';
  return res.status(200).json({ success: true, data: { message: 'Payment request rejected.' } });
});

// Record intents for payments
app.post('/api/record-payment-intent', (req, res) => {
  const me = getUserByToken(req);
  if (!me) return res.status(401).json({ message: 'Unauthorized.' });
  const { plan, credits, amount, orderId } = req.body || {};
  const rec = {
    id: STORE.nextPaymentRequestId++,
    userId: me.id,
    userName: me.name,
    userEmail: me.email,
    plan,
    credits,
    amount,
    utrCode: orderId,
    date: new Date().toISOString().split('T')[0],
    note: 'Cashfree UPI Intent',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  STORE.paymentRequests.push(rec);
  return res.status(200).json({ success: true });
});

app.post('/api/record-crypto-intent', (req, res) => {
  const me = getUserByToken(req);
  if (!me) return res.status(401).json({ message: 'Unauthorized.' });
  const { orderId, credits, amount } = req.body || {};
  const rec = {
    id: STORE.nextCryptoTransactionId++,
    userId: me.id,
    userName: me.name,
    userEmail: me.email,
    orderId,
    credits,
    amount,
    currency: 'USD',
    gateway: 'OXPAY',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  STORE.cryptoTransactions.push(rec);
  return res.status(200).json({ success: true });
});

app.post('/api/generate', async (req, res) => {
  try {
    const me = getUserByToken(req);
    const { prompt, numberOfImages } = req.body || {};
    const nRaw = Number(numberOfImages);
    const n = Math.min(Math.max(isNaN(nRaw) ? 1 : nRaw, 1), 6);

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'Invalid prompt' });
    }
    if (!me) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }
    const needed = IMAGE_COST * n;
    if ((me.credits || 0) < needed) {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }

    const apiKey = process.env.A4F_API_KEY;
    const model = process.env.A4F_MODEL || 'provider-4/imagen-3.5';
    let baseUrl = process.env.A4F_BASE_URL || 'https://api.a4f.co/v1/images/generations';
    if (baseUrl.includes('api.a4f.ai')) baseUrl = baseUrl.replace('api.a4f.ai', 'api.a4f.co');
    if (baseUrl.endsWith('/images/generate')) baseUrl = baseUrl.replace('/images/generate', '/images/generations');
    if (!apiKey) {
      console.error('A4F_API_KEY missing');
      return res.status(500).json({ message: 'Missing A4F_API_KEY' });
    }

    const makePayload = (count) => ({ model, prompt, num_images: count, size: '1024x1024' });
    const r = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(makePayload(n)) });
    const contentType = r.headers.get('content-type') || '';
    const rawText = await r.text();
    let data = null;
    try { if (contentType.includes('application/json')) data = JSON.parse(rawText); } catch {}
    if (!r.ok || !data) {
      const msg = (data && (data.message || data.error || data.detail || data.reason)) || 'Image provider error';
      return res.status(r.status).json({ message: msg });
    }

    let images = [];
    const src = Array.isArray(data.images) ? data.images : Array.isArray(data.data) ? data.data : [];
    images = src.map((img) => {
      if (typeof img === 'string') return { url: img };
      if (img && typeof img.url === 'string') return { url: img.url };
      if (img && typeof img.base64 === 'string') return { url: `data:image/png;base64,${img.base64}` };
      if (img && typeof img.b64_json === 'string') return { url: `data:image/png;base64,${img.b64_json}` };
      if (img && typeof img.b64 === 'string') return { url: `data:image/png;base64,${img.b64}` };
      return null;
    }).filter(Boolean);

    const count = images.length || n;
    const cost = IMAGE_COST * count;
    const uIndex = STORE.users.findIndex(u => u.id === me.id);
    if (uIndex > -1) {
      STORE.users[uIndex].credits = Math.max(0, (STORE.users[uIndex].credits || 0) - cost);
    }
    return res.status(200).json({ success: true, images, newCredits: STORE.users[uIndex]?.credits || me.credits });
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
      if (data.order_status === 'PAID') {
        const reqIndex = STORE.paymentRequests.findIndex(p => p.utrCode === orderId);
        if (reqIndex > -1) {
          const pr = STORE.paymentRequests[reqIndex];
          STORE.paymentRequests[reqIndex].status = 'approved';
          const uIndex = STORE.users.findIndex(u => u.id === pr.userId);
          if (uIndex > -1) {
            STORE.users[uIndex].credits = (STORE.users[uIndex].credits || 0) + (pr.credits || 0);
          }
        }
      }
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
