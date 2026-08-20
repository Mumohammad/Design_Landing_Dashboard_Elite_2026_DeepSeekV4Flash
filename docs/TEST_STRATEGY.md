# TEST_STRATEGY.md — EliteDev Platform

**Last Updated:** 2026-08-20
**Framework:** Vitest 4.1.10

---

## Current Test Coverage

### Unit Tests (195 tests, 19 files)

| Module | Tests | Coverage |
|--------|-------|----------|
| ZATCA Crypto | 15 | CSR, key generation, certificate |
| ZATCA Transport | 14 | Transmission, retry logic |
| ZATCA CSID | 13 | CSID management, masking |
| ZATCA Onboarding | 6 | Onboarding flow |
| ZATCA UBL | 15 | XML generation |
| ZATCA Copy Audit | 3 | Compliance claims |
| ZATCA Core | 7 | Core functions |
| Invoice Math | 15 | Rounding, line computation |
| Invoice HTML | 9 | Document rendering |
| Invoice QR | 6 | QR generation |
| VAT Math | 8 | VAT calculations |
| Report HTML | 13 | Report rendering |
| Payroll Calculation | 16 | Salary computation |
| WPS Generator | 13 | WPS file generation |
| CSV Utils | 14 | CSV parsing |
| Financial Events | 3 | Event dispatch |
| Auth Invite Tokens | 10 | Token generation/verify |
| Document Templates | 9 | Template rendering |
| Report Generator | 6 | Report generation |

### Missing Test Coverage

| Area | Priority | Reason |
|------|----------|--------|
| Server Actions | P1 | Critical business logic |
| RLS Policies | P1 | Security-critical |
| Proxy/Middleware | P1 | Auth-critical |
| Frontend Components | P2 | UI regression |
| E2E Flows | P2 | Full workflow |
| Performance | P3 | Load testing |

## Test Priority Matrix

### P1 — Must Have
1. **Server action integration tests** — Test each action with mock Supabase
2. **RLS policy tests** — Verify tenant isolation
3. **Auth flow tests** — Login, logout, token refresh

### P2 — Should Have
4. **Component unit tests** — Critical UI components
5. **E2E smoke tests** — Login → Dashboard → CRUD
6. **API contract tests** — Request/response validation

### P3 — Nice to Have
7. **Visual regression tests** — Screenshot comparison
8. **Performance tests** — Load testing
9. **Accessibility tests** — Automated a11y checks

## Testing Commands

```bash
# Run all tests
npx vitest run

# Run specific test file
npx vitest run src/lib/accounting/invoice-math.test.ts

# Run in watch mode
npx vitest

# Run with coverage
npx vitest run --coverage
```

## Test Data

- Mock data is created inline in test files
- No shared test fixtures (could be improved)
- Database mocking via `__mocks__` pattern
