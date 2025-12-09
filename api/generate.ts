export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

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

        // Ensure URL correctness
        if (baseUrl.includes('api.a4f.ai')) {
            baseUrl = baseUrl.replace('api.a4f.ai', 'api.a4f.co');
        }
        if (baseUrl.endsWith('/images/generate')) {
            baseUrl = baseUrl.replace('/images/generate', '/images/generations');
        }

        if (!apiKey) {
            console.error('[Generate] Missing A4F_API_KEY');
            return res.status(500).json({ message: 'Missing A4F_API_KEY' });
        }

        const makePayload = (count: number) => ({
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
            console.error('[Generate] Failed to parse JSON response:', rawText.substring(0, 200));
        }

        if (!r.ok) {
            const msg = (data && (data.message || data.error || data.detail || data.reason)) || 'Image provider error';
            console.error('[Generate] Provider error:', { status: r.status, data: data || rawText });
            return res.status(r.status).json({ message: msg, debug: { status: r.status, rawResponse: rawText.substring(0, 500) } });
        }

        if (!data || (typeof data !== 'object')) {
            console.error('[Generate] Malformed response (not object):', rawText.substring(0, 200));
            return res.status(500).json({ message: 'Malformed provider response', raw: rawText.substring(0, 200) });
        }

        let images: Array<{ url: string }> = [];
        const fromImages = Array.isArray((data as any).images) ? (data as any).images : [];
        const fromData = Array.isArray((data as any).data) ? (data as any).data : [];

        if (fromImages.length) {
            images = fromImages.map((img: any) => {
                if (typeof img === 'string') return { url: img };
                if (img && typeof img.url === 'string') return { url: img.url };
                if (img && typeof img.base64 === 'string') return { url: `data:image/png;base64,${img.base64}` };
                if (img && typeof img.b64 === 'string') return { url: `data:image/png;base64,${img.b64}` };
                return { url: '' };
            }).filter(i => i.url);
        } else if (fromData.length) {
            images = fromData.map((d: any) => {
                if (d && typeof d.url === 'string') return { url: d.url };
                if (d && typeof d.b64_json === 'string') return { url: `data:image/png;base64,${d.b64_json}` };
                return null;
            }).filter(Boolean) as Array<{ url: string }>;
        }

        console.log(`[Generate] Success, Got ${images.length} images`);

        // Supplement if fewer than requested
        let attempts = 0;
        const normalize = (payload: any) => {
            const out: Array<{ url: string }> = [];
            const imgs = Array.isArray(payload?.images) ? payload.images : [];
            const dat = Array.isArray(payload?.data) ? payload.data : [];
            if (imgs.length) {
                imgs.forEach((img: any) => {
                    if (typeof img === 'string') out.push({ url: img });
                    else if (img && typeof img.url === 'string') out.push({ url: img.url });
                    else if (img && typeof img.base64 === 'string') out.push({ url: `data:image/png;base64,${img.base64}` });
                    else if (img && typeof img.b64 === 'string') out.push({ url: `data:image/png;base64,${img.b64}` });
                });
            } else if (dat.length) {
                dat.forEach((d: any) => {
                    if (d && typeof d.url === 'string') out.push({ url: d.url });
                    else if (d && typeof d.b64_json === 'string') out.push({ url: `data:image/png;base64,${d.b64_json}` });
                });
            }
            return out;
        };

        const seen = new Set(images.map(i => i.url));

        while (images.length < n && attempts < 3) {
            attempts++;
            console.log(`[Generate] Retry attempt ${attempts} for ${n - images.length} more images`);
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
                console.warn(`[Generate] Retry failed: ${r2.status}`);
                break;
            }

            const add = normalize(d2);
            add.forEach((i: any) => { if (i && i.url && !seen.has(i.url)) { images.push(i); seen.add(i.url); } });
        }

        return res.status(200).json({ success: true, images });
    } catch (error: any) {
        console.error('[Generate] API error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}
