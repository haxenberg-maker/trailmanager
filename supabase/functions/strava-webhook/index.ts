// Supabase Edge Function: strava-webhook
// Handles Strava webhook events + manual sync trigger
// Deploy: supabase functions deploy strava-webhook

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRAVA_CLIENT_ID     = Deno.env.get('STRAVA_CLIENT_ID')!;
const STRAVA_CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET')!;
const STRAVA_REFRESH_TOKEN = Deno.env.get('STRAVA_REFRESH_TOKEN')!;
const STRAVA_VERIFY_TOKEN  = Deno.env.get('STRAVA_VERIFY_TOKEN') ?? 'trail_manager_2026';
const OWNER_USER_ID        = Deno.env.get('OWNER_USER_ID')!;
const SB_URL               = Deno.env.get('SUPABASE_URL')!;
const SB_SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SB_URL, SB_SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function corsResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Get fresh Strava access token ──────────────────────
async function getStravaToken(): Promise<string> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Strava token: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Fetch one activity from Strava ─────────────────────
async function fetchActivity(activityId: number, token: string) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

// ── Fetch all activities (for full sync) ──────────────
async function fetchAllActivities(token: string, after?: number) {
  const acts: any[] = [];
  let page = 1;
  while (true) {
    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    url.searchParams.set('per_page', '200');
    url.searchParams.set('page', String(page));
    if (after) url.searchParams.set('after', String(after));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    acts.push(...batch);
    if (batch.length < 200) break;
    page++;
  }
  return acts;
}

// ── Normalize Strava activity → our format ─────────────
function normalizeActivity(act: any) {
  const type = act.sport_type?.toLowerCase() || act.type?.toLowerCase() || '';
  let normType = 'road';
  if (type.includes('trail') || type === 'trailrun') normType = 'trail';
  else if (type.includes('track') || type === 'treadmill') normType = 'track';
  else if (type.includes('run')) normType = 'road';
  else return null; // skip non-running

  const km = Math.round((act.distance / 1000) * 10) / 10;
  if (km < 0.5) return null; // skip near-zero

  return {
    id:    `strava_${act.id}`,
    date:  act.start_date_local?.substring(0, 10),
    name:  act.name,
    type:  normType,
    km,
    elev:  Math.round(act.total_elevation_gain || 0),
    dur:   act.moving_time || 0,
    source: 'strava',
  };
}

// ── Upsert activities into trail_data for owner ────────
async function upsertActivities(newActs: any[]) {
  // Load current data
  const { data: rows, error } = await supabase
    .from('trail_data')
    .select('data')
    .eq('user_id', OWNER_USER_ID)
    .limit(1);

  if (error || !rows?.length) {
    console.error('Could not load trail_data:', error);
    return { added: 0 };
  }

  const D = rows[0].data;
  const existing: any[] = D.activities || [];

  // Deduplicate by id
  const existingIds = new Set(existing.map((a: any) => a.id));
  const toAdd = newActs.filter(a => a && !existingIds.has(a.id));

  if (toAdd.length === 0) return { added: 0 };

  const merged = [...existing, ...toAdd].sort((a, b) => b.date.localeCompare(a.date));
  D.activities = merged;

  const { error: updateErr } = await supabase
    .from('trail_data')
    .update({ data: D })
    .eq('user_id', OWNER_USER_ID);

  if (updateErr) throw new Error('DB update failed: ' + updateErr.message);
  return { added: toAdd.length };
}

// ── Main handler ───────────────────────────────────────
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── CORS preflight ──────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // ── Strava webhook verification (GET) ──────────────
  if (req.method === 'GET') {
    const challenge = url.searchParams.get('hub.challenge');
    const verify    = url.searchParams.get('hub.verify_token');
    if (verify === STRAVA_VERIFY_TOKEN && challenge) {
      return corsResponse(JSON.stringify({ 'hub.challenge': challenge }));
    }
    return corsResponse(JSON.stringify({ error: 'Unauthorized' }), 401);
  }

  // ── Manual full sync (POST /sync) ──────────────────
  if (req.method === 'POST' && url.pathname.endsWith('/sync')) {
    try {
      const token = await getStravaToken();
      const after = Math.floor(Date.now() / 1000) - 2 * 365 * 86400;
      const raw   = await fetchAllActivities(token, after);
      const acts  = raw.map(normalizeActivity).filter(Boolean);
      const result = await upsertActivities(acts);
      return corsResponse(JSON.stringify({ ok: true, fetched: raw.length, ...result }));
    } catch (e: any) {
      return corsResponse(JSON.stringify({ ok: false, error: e.message }), 500);
    }
  }

  // ── Strava webhook event (POST) ─────────────────────
  if (req.method === 'POST') {
    try {
      const event = await req.json();
      console.log('Strava event:', JSON.stringify(event));

      if (event.object_type !== 'activity') return corsResponse('OK');
      if (!['create', 'update'].includes(event.aspect_type)) return corsResponse('OK');

      const token = await getStravaToken();
      const act   = await fetchActivity(event.object_id, token);
      const norm  = normalizeActivity(act);

      if (norm) {
        await upsertActivities([norm]);
        console.log(`Synced activity: ${norm.name} (${norm.km} km)`);
      }

      return corsResponse('OK');
    } catch (e: any) {
      console.error('Webhook error:', e);
      return corsResponse(JSON.stringify({ error: e.message }), 500);
    }
  }

  return corsResponse(JSON.stringify({ error: 'Method Not Allowed' }), 405);
});