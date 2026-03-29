// PC Cabinets — Anthropic API Proxy
// Deploy to: /functions/ai-proxy.js
// Cloudflare env var required: ANTHROPIC_API_KEY
//
// Handles two actions:
//   scanBlueprint  — image/PDF (base64) → cabinet counts + install details JSON
//   generateScope  — job details → customer scope description (text)

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

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
  if (action === 'scanBlueprint') {
    const { imageBase64, mediaType } = payload;

    const scanPrompt = `You are an expert cabinet installer reading professional kitchen/bathroom cabinet shop drawings.

Study ALL visible pages carefully — floor plans, elevations, parts schedules, and any detail callouts.

Count every individual numbered cabinet unit. Be precise and thorough.

IMPORTANT — also look for these specific details:
• CROWN MOULDING: Look for "crown", "CMK", "CM", or moulding callouts at the top of upper cabinets. If uppers exist, crown is very common — estimate linear feet by summing the widths of all upper cabinet runs. Also count mitre cuts (inside corners, outside corners, returns).
• UNDER-COUNTER LIGHTING: Look for "LED", "UC light", "puck light", "lighting channel", light switch callouts, or electrical notes near upper/lower cabinets. Note if any lighting is specified.
• BASEBOARDS: Look for "baseboard", "base trim", "BB" near floor level, especially where cabinets meet adjacent walls/rooms. Count transition pieces where baseboard meets cabinet toe kicks.
• BACKSPLASH: Look for "backsplash", "BS", "tile", "subway tile", "mosaic", or tile callouts between the countertop and upper cabinets. Note the type if specified (subway, mosaic, slab, etc.) and estimate the square footage if dimensions are visible.
• ROOM TYPE: Identify what room this is — kitchen, bathroom, laundry, mudroom, butler's pantry, bar, etc.

Return ONLY a raw JSON object (no markdown, no backticks, no explanation):
{
  "client": "<client/project name from title block if visible>",
  "roomType": "<kitchen|bathroom|laundry|mudroom|bar|butler_pantry|other>",
  "layout": "<L-shape|U-shape|galley|island|linear|other>",
  "lowers": <integer — standard base/lower cabinets at counter height>,
  "uppers": <integer — wall-mounted upper/wall cabinets>,
  "corners": <integer — corner units, blind corners, lazy susans, magic corners>,
  "tallUnits": <integer — pantry towers, tall cabinets 84"+ height>,
  "sinkBases": <integer — sink base cabinets>,
  "islands": <integer — island or peninsula groups, count as 1 even if multiple boxes>,
  "crownLF": <integer — estimated linear feet of crown moulding. If uppers exist and crown is not explicitly excluded, estimate from upper cabinet run widths>,
  "crownCuts": <integer — estimated mitre cuts for crown (corners + returns). Minimum 2 for end returns>,
  "crownDetected": <boolean — true if crown/moulding is explicitly shown or noted on the drawing>,
  "toekickRuns": <integer — number of toe kick runs>,
  "hardwareCount": <integer — total pull or knob holes if inferable from specs or door/drawer count>,
  "hasUCLighting": <boolean — true if under-counter or under-cabinet lighting is noted on the drawing>,
  "ucLightingLF": <integer — estimated linear feet of lighting channel if detectable, else 0>,
  "baseboardPieces": <integer — number of baseboard transition pieces where cabinets meet adjacent walls>,
  "hasBacksplash": <boolean — true if backsplash is noted or called out on the drawing>,
  "backsplashType": "<subway|mosaic|slab|tile|unknown|none — type if detectable>",
  "backsplashSqFt": <integer — estimated square footage of backsplash area if detectable, else 0>,
  "difficulty": "<simple|standard|complex — based on wall conditions, ceiling notes, corner complexity>",
  "notes": "<key installation notes: special conditions, unusual features, room shape, anything affecting time>"
}`;

    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          {
            type: mediaType === 'application/pdf' ? 'document' : 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: scanPrompt },
        ],
      }],
    };

    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        return new Response(JSON.stringify({ error: 'Anthropic API error: ' + apiRes.status, detail: errText }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const data = await apiRes.json();
      const raw = data.content?.[0]?.text || '{}';
      const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);

      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Scan failed: ' + err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  // ── generateScope ───────────────────────────────────────────────────────────
  if (action === 'generateScope') {
    const { prompt } = payload;

    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    };

    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        return new Response(JSON.stringify({ error: 'Anthropic API error: ' + apiRes.status, detail: errText }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const data = await apiRes.json();
      const text = data.content?.[0]?.text || '';

      return new Response(JSON.stringify({ text }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Scope generation failed: ' + err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action: ' + action }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
