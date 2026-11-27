/**
 * Vercel Serverless Function: /api/cloud-auth
 * Keeps the Cloud PDF public key on the server (Vercel Environment Variable: CLOUD_PDF_PUBLIC_KEY)
 * so it is never committed to GitHub or exposed in the client JS bundle.
 */
interface VercelReq {
  method?: string;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: unknown) => void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const publicKey = process.env.CLOUD_PDF_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(500).json({ error: 'Server missing CLOUD_PDF_PUBLIC_KEY env var' });
  }

  try {
    const upstream = await fetch('https://api.ilovepdf.com/v1/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: publicKey }),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Upstream auth request failed',
    });
  }
}
