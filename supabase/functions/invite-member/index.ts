import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = request.headers.get('Authorization');
  if (!url || !serviceKey || !authHeader) return respond({ error: 'Service is not configured' }, 503);

  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user: actor }, error: authError } = await userClient.auth.getUser();
  if (authError || !actor) return respond({ error: 'Sign in required' }, 401);

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { email, displayName, workspaceId } = await request.json();
  if (typeof email !== 'string' || !email.includes('@') || typeof workspaceId !== 'string') {
    return respond({ error: 'A valid email and workspace are required' }, 400);
  }

  const { data: membership } = await adminClient.from('workspace_members')
    .select('role').eq('workspace_id', workspaceId).eq('user_id', actor.id).maybeSingle();
  if (membership?.role !== 'admin') return respond({ error: 'Workspace admin access required' }, 403);

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email.trim(), {
    data: { full_name: String(displayName ?? '').trim().slice(0, 100) },
  });
  if (inviteError || !invited.user) return respond({ error: inviteError?.message ?? 'Could not send invitation' }, 400);

  const { error: membershipError } = await adminClient.from('workspace_members').upsert({
    workspace_id: workspaceId,
    user_id: invited.user.id,
    display_name: String(displayName ?? '').trim().slice(0, 100),
    role: 'member',
  });
  if (membershipError) return respond({ error: membershipError.message }, 500);

  return respond({ invited: true, email: email.trim() }, 200);
});

function respond(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
