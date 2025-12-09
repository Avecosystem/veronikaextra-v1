import { IncomingMessage, ServerResponse } from 'http';
import { loadEnv } from 'vite';

// Helper to parse JSON body
const parseBody = (req: IncomingMessage): Promise<any> => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
};

export const apiMiddleware = (mode: string) => {
    const env = loadEnv(mode, process.cwd(), '');

    return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url && req.url.startsWith('/api/proxy-image') && req.method === 'GET') {
            try {
                const q = req.url.includes('?') ? req.url.split('?')[1] : '';
                const params = new URLSearchParams(q);
                const url = params.get('url') || '';
                if (!url) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ message: 'Missing url' }));
                    return;
                }
                let parsed: URL;
                try {
                    parsed = new URL(url);
                } catch {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ message: 'Invalid url' }));
                    return;
                }
                if (parsed.protocol !== 'https:' || (parsed.hostname !== 'api.a4f.co' && parsed.hostname !== 'a4f.co')) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ message: 'Forbidden host' }));
                    return;
                }
                const r = await fetch(url);
                if (!r.ok) {
                    res.statusCode = r.status;
                    res.end(JSON.stringify({ message: 'Upstream image error' }));
                    return;
                }
                const ct = r.headers.get('content-type') || 'image/jpeg';
                const buf = Buffer.from(await r.arrayBuffer());
                res.statusCode = 200;
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', ct);
                res.end(buf);
            } catch (error: any) {
                console.error('[API] Proxy Error:', error);
                res.statusCode = 500;
                res.end(JSON.stringify({ message: 'Internal Server Error: ' + error.message }));
            }
        } else if (req.url === '/api/generate' && req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { prompt, numberOfImages } = body || {};

                // --- LOGIC FROM api/generate.ts ---
                const nRaw = Number(numberOfImages);
                const n = Math.min(Math.max(isNaN(nRaw) ? 1 : nRaw, 1), 6);

                if (!prompt || typeof prompt !== 'string') {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ message: 'Invalid prompt' }));
                    return;
                }

                const apiKey = env.A4F_API_KEY;
                const model = env.A4F_MODEL || 'provider-4/imagen-3.5';
                let baseUrl = env.A4F_BASE_URL || 'https://api.a4f.co/v1/images/generations';

                // Ensure URL correctness
                if (baseUrl.includes('api.a4f.ai')) {
                    baseUrl = baseUrl.replace('api.a4f.ai', 'api.a4f.co');
                }
                if (baseUrl.endsWith('/images/generate')) {
                    baseUrl = baseUrl.replace('/images/generate', '/images/generations');
                }

                if (!apiKey) {
                    console.error('[API] Missing A4F_API_KEY');
                    res.statusCode = 500;
                    res.end(JSON.stringify({ message: 'Missing A4F_API_KEY' }));
                    return;
                }

                const makePayload = (count: number) => ({
                    model,
                    prompt,
                    num_images: count,
                    size: '1024x1024'
                });

                console.log(`[API] Requesting ${n} images from ${baseUrl}`);

                const r = await fetch(baseUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(makePayload(n))
                });

                const contentType = r.headers.get('content-type') || '';
                let data: any = null;

                // Always try to get text first
                const rawText = await r.text();

                try {
                    if (contentType.includes('application/json')) {
                        data = JSON.parse(rawText);
                    }
                } catch (e) {
                    console.error('[API] Failed to parse JSON response:', rawText.substring(0, 200));
                }

                if (!r.ok) {
                    const msg = (data && ((data as any).message || (data as any).error || (data as any).detail || (data as any).reason)) || 'Image provider error';
                    console.error('[API] Provider Error:', { status: r.status, data: data || rawText });
                    res.statusCode = r.status;
                    res.end(JSON.stringify({ message: msg, debug: { status: r.status, rawResponse: rawText.substring(0, 500) } }));
                    return;
                }

                if (!data || (typeof data !== 'object')) {
                    console.error('[API] Malformed response (not object):', rawText.substring(0, 200));
                    res.statusCode = 500;
                    res.end(JSON.stringify({ message: 'Malformed provider response', raw: rawText.substring(0, 200) }));
                    return;
                }

                // Response Processing
                let images: Array<{ url: string }> = [];
                const fromImages = Array.isArray((data as any).images) ? (data as any).images : [];
                const fromData = Array.isArray((data as any).data) ? (data as any).data : [];

                if (fromImages.length) {
                    images = fromImages.map((img: any) => {
                        if (typeof img === 'string') return { url: img };
                        if (img && typeof img.url === 'string') return { url: img.url };
                        if (img && typeof img.base64 === 'string') return { url: `data:image/png;base64,${img.base64}` };
                        if (img && typeof img.b64 === 'string') return { url: `data:image/png;base64,${img.b64}` };
                        return null;
                    }).filter((i: any) => i && i.url);
                } else if (fromData.length) {
                    images = fromData.map((d: any) => {
                        if (d && typeof d.url === 'string') return { url: d.url };
                        if (d && typeof d.b64_json === 'string') return { url: `data:image/png;base64,${d.b64_json}` };
                        return null;
                    }).filter(Boolean) as Array<{ url: string }>;
                }

                console.log(`[API] Success, Got ${images.length} images`);

                // Supplement if fewer than requested
                let attempts = 0;
                const normalize = (payload: any) => {
                    const out: Array<{ url: string }> = [];
                    const imgs = Array.isArray(payload?.images) ? payload.images : [];
                    const dat = Array.isArray(payload?.data) ? payload.data : [];
                    if (imgs.length) {
                        imgs.forEach((img: any) => {
                            if (typeof img === 'string') out.push({ url: img });
                            else if (img && typeof img.url === 'string') return { url: img.url };
                            else if (img && typeof img.base64 === 'string') return { url: `data:image/png;base64,${img.base64}` };
                            else if (img && typeof img.b64 === 'string') return { url: `data:image/png;base64,${img.b64}` };
                        });
                    } else if (dat.length) {
                        dat.forEach((d: any) => {
                            if (d && typeof d.url === 'string') return { url: d.url };
                            else if (d && typeof d.b64_json === 'string') return { url: `data:image/png;base64,${d.b64_json}` };
                        });
                    }
                    return out;
                };

                const seen = new Set(images.map(i => i.url));

                while (images.length < n && attempts < 3) {
                    attempts++;
                    console.log(`[API] Retry attempt ${attempts} for ${n - images.length} more images`);
                    const remaining = n - images.length;

                    const r2 = await fetch(baseUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(makePayload(remaining))
                    });

                    const rawText2 = await r2.text();
                    let d2: any = null;
                    try { d2 = JSON.parse(rawText2); } catch { }

                    if (!r2.ok) {
                        console.warn(`[API] Retry failed: ${r2.status}`);
                        break;
                    }

                    const add = normalize(d2);
                    add.forEach((i: any) => { if (i && i.url && !seen.has(i.url)) { images.push(i); seen.add(i.url); } });
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, images }));
                // ----------------------------------

            } catch (error: any) {
                console.error('[API] Middleware Error:', error);
                res.statusCode = 500;
                res.end(JSON.stringify({ message: 'Internal Server Error: ' + error.message }));
            }
        } else if (req.url === '/api/cashfree' && req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { orderId, amount, customerPhone, customerName, customerEmail, returnUrl } = body;

                if (!orderId || !amount || !customerPhone || !customerName) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ message: 'Missing required fields for Cashfree payment.' }));
                    return;
                }

                const CASHFREE_APP_ID = env.CASHFREE_APP_ID;
                const CASHFREE_SECRET_KEY = env.CASHFREE_SECRET_KEY;
                if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ message: 'Cashfree credentials missing' }));
                    return;
                }

                const payload = {
                    order_id: orderId,
                    order_amount: amount,
                    order_currency: "INR",
                    customer_details: {
                        customer_id: orderId.split('-')[0] || "guest",
                        customer_name: customerName,
                        customer_email: customerEmail,
                        customer_phone: customerPhone
                    },
                    order_meta: {
                        return_url: returnUrl
                    }
                };

                const response = await fetch('https://api.cashfree.com/pg/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-client-id': CASHFREE_APP_ID,
                        'x-client-secret': CASHFREE_SECRET_KEY,
                        'x-api-version': '2022-09-01'
                    },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (response.ok && data.payment_link) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({
                        success: true,
                        paymentLink: data.payment_link,
                        paymentSessionId: data.payment_session_id
                    }));
                } else {
                    console.error("Cashfree API Error:", data);
                    res.statusCode = 400;
                    res.end(JSON.stringify({
                        success: false,
                        message: data.message || "Failed to initiate Cashfree payment"
                    }));
                }
            } catch (error: any) {
                console.error("Cashfree Middleware Error:", error);
                res.statusCode = 500;
                res.end(JSON.stringify({ message: error.message || "Internal Server Error" }));
            }
        } else if (req.url === '/api/oxapay' && req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { amount, orderId, email, description, returnUrl } = body;

                if (!amount || !orderId) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ message: 'Missing required fields for Oxapay.' }));
                    return;
                }

                const OXPAY_MERCHANT_ID = 'QB5WB5-GAS15X-IBUGYW-SNGIRG';

                const payload = {
                    merchant: OXPAY_MERCHANT_ID,
                    amount: amount,
                    currency: 'USD',
                    lifeTime: 30,
                    feePaidByPayer: 0,
                    underPaidCover: 0,
                    returnUrl: returnUrl,
                    description: description,
                    orderId: orderId,
                    email: email
                };

                const response = await fetch('https://api.oxapay.com/merchants/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (data.result === 100 && data.payLink) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({
                        success: true,
                        paymentUrl: data.payLink
                    }));
                } else {
                    console.error("Oxapay API Error:", data);
                    res.statusCode = 400;
                    res.end(JSON.stringify({
                        success: false,
                        message: data.message || "Failed to create crypto invoice"
                    }));
                }
            } catch (error: any) {
                console.error("Oxapay Middleware Error:", error);
                res.statusCode = 500;
                res.end(JSON.stringify({ message: "Internal Server Error" }));
            }
        } else if (req.url === '/api/verify-payment' && req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { orderId } = body;

                if (!orderId) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ message: 'Missing orderId' }));
                    return;
                }

                const CASHFREE_APP_ID = env.CASHFREE_APP_ID;
                const CASHFREE_SECRET_KEY = env.CASHFREE_SECRET_KEY;
                if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ message: 'Cashfree credentials missing' }));
                    return;
                }

                const response = await fetch(`https://api.cashfree.com/pg/orders/${orderId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-client-id': CASHFREE_APP_ID,
                        'x-client-secret': CASHFREE_SECRET_KEY,
                        'x-api-version': '2022-09-01'
                    }
                });

                const data = await response.json();

                if (response.ok) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({
                        success: true,
                        status: data.order_status
                    }));
                } else {
                    res.statusCode = 400;
                    res.end(JSON.stringify({
                        success: false,
                        message: data.message || "Failed to verify payment"
                    }));
                }
            } catch (error: any) {
                console.error("Verify Payment Middleware Error:", error);
                res.statusCode = 500;
                res.end(JSON.stringify({ message: "Internal Server Error" }));
            }
        } else {
            next();
        }
    };
};
