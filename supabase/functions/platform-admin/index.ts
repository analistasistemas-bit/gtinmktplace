import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requirePlatformAdmin } from '../_shared/platform-admin/auth.ts';
import { createPlatformAdminHandler } from '../_shared/platform-admin/handler.ts';
import { createPlatformAdminRepository } from '../_shared/platform-admin/repository.ts';

const handler = createPlatformAdminHandler({
  authenticate: requirePlatformAdmin,
  repository: createPlatformAdminRepository(adminClient() as never),
  corsHeaders,
});

Deno.serve(handler);
