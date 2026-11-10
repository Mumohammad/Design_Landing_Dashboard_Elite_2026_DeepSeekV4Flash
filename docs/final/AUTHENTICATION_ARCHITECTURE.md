# AUTHENTICATION_ARCHITECTURE.md — EliteDev Platform

**Audit Date:** 2026-08-20

---

## Auth Flow

```
Browser → /auth/sign-in → Supabase Auth (email+password)
    → JWT issued
    → SSR cookie set (httpOnly)
    → proxy.ts validates JWT server-side
    → users table profile lookup
    → Account status check
    → Redirect to /dashboard
```

## Session Management

| Component | Implementation | Status |
|-----------|---------------|:------:|
| JWT Validation | `supabase.auth.getUser()` in proxy.ts | ✅ |
| Session Refresh | SSR client refreshes tokens, writes cookies | ✅ |
| Cookie Security | httpOnly, Secure, SameSite=Lax | ✅ |
| Logout | Supabase `signOut()` + cookie clear | ✅ |
| Password Hashing | Supabase Auth (bcrypt) | ✅ |
| Email Verification | Supabase Auth built-in | ✅ |
| Password Reset | `/auth/reset-password` flow | ✅ |
| Account Lockout | `banned_until` via trigger + sync | ✅ |
| MFA | ❌ Not implemented | ⚠️ |
| SSO | ❌ Not implemented | ⚠️ |

## Auth Pages

| Route | Purpose | Auth Required |
|-------|---------|:-------------:|
| `/auth/sign-in` | Login | No |
| `/auth/sign-up` | Register | No |
| `/auth/forgot-password` | Password reset request | No |
| `/auth/reset-password` | Password reset confirm | No |
| `/auth/accept-invite` | Accept team invite | Token |

## Security Events

| Event | Logged? | Location |
|-------|:-------:|----------|
| Login success | ⚠️ | Not explicitly |
| Login failure | ⚠️ | Supabase dashboard only |
| Password reset | ⚠️ | Not explicitly |
| Role change | ✅ | `writeAuditLog()` |
| Account locked | ⚠️ | Trigger only |

## Recommendations

1. **Add login/logout audit logging** — Capture who logged in and when
2. **Implement MFA** — Critical for enterprise financial platform
3. **Add session listing** — Let users see active sessions
4. **Add brute force protection** — Rate limiting on auth endpoints (partially done)
