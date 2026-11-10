// Use the same cookie-backed browser session as dashboard authentication.
// A separate supabase-js client would look in localStorage and request another login.
export { createClient as getBrowserSupabase } from '@/lib/supabase/client'
