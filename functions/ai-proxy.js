// PC Cabinets — Anthropic API Proxy
// Deploy to: /functions/ai-proxy.js
// Cloudflare env var required: ANTHROPIC_API_KEY
//
// Handles two actions:
//   scanBlueprint  — image (base64) → cabinet counts JSON
//   generateScope  — job details → customer scope description (text)
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers so the front-end can call this from any origin during dev
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const { action, payload } = body;

  // ── scanBlueprint ───────────────────────────────────────────────────────────
  // payload: { imageBase64: string, mediaType: string }
  // returns: { lowers, uppers, corners, tallUnits, sinkBases, islands,
  //            crownLF, crownCuts, toekickRuns, hardwareCount, notes }
  if (action === 'scanBlueprint') {
    const { imageBase64, mediaType } = payload;

    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `You are an expert cabinet installer reading a professional kitchen/bathroom cabinet shop drawing from North & Brown (Chatham, ON).

Study ALL visible pages carefully — floor plan, elevations, and any parts schedule/bill of materials.

Count every individual numbered cabinet unit. Be precise.

Return ONLY a raw JSON object — no markdown, no backticks, no explanation:
{
  "lowers": <integer — standard base/lower cabinets at counter height>,
  "uppers": <integer — wall-mounted upper/wall cabinets>,
  "corners": <integer — corner units, blind corners, lazy susans, magic corners>,
  "tallUnits": <integer — pantry towers, tall cabinets 84"+ height>,
  "sinkBases": <integer — sink base cabinets>,
  "islands": <integer — island or peninsula groups, count as 1 even if multiple boxes>,
  "crownLF": <integer — estimated linear feet of crown or flat-board moulding if specified>,
  "crownCuts": <integer — estimated number of mitre cuts for crown>,
  "toekickRuns": <integer — number of toe kick runs>,
  "hardwareCount": <integer — total pull or knob holes if inferable>,
  "notes": "<one sentence: layout shape e.g. L-shape with island, and any notable site conditions>"
}`,
          },
        ],
      }],
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: `Anthropic error: ${err}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await response.json();
    const raw = data.content?.find(b => b.type === 'text')?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();

    return new Response(clean, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── generateScope ───────────────────────────────────────────────────────────
  // payload: { prompt: string }
  // returns plain text scope description
  if (action === 'generateScope') {
    const { prompt } = payload;

    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: `Anthropic error: ${err}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text?.trim() || '';

    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
