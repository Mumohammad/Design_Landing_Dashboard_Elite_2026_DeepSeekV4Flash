# Dashboard Screenshot Workflow

How to re-capture the real dashboard screenshots shown on the **landing page**
(`#showcase`) and publish them. Use this whenever the dashboard UI changes.

## What the landing page uses

| Landing slot        | File                         | Source page   |
| ------------------- | ---------------------------- | ------------- |
| Main screenshot     | `public/dashboard-*-v2.png`  | `/dashboard`  |
| Feature card 1      | `public/feature-1-*-v2.png`  | `/drivers`    |
| Feature card 2      | `public/feature-2-*-v2.png`  | `/vehicles`   |

(`*-v2` = light + dark; all images are 2400×1500 = viewport 1600×1000 @ 1.5 DPR.)

## Why versioned filenames

Browsers and the Next.js image cache aggressively cache `public/*.png`.
Renaming the files to a new suffix (e.g. `-v3`) guarantees every visitor gets
the new screenshots — query strings (`?v=`) do NOT work with `next/image`
without restrictive `images.localPatterns` config, so use filenames instead.

## Steps

### 1. Start the app + seed data

- Dev server must be running on `http://localhost:3000`.
- Seed demo data so the pages show real content:

  ```bash
  node scripts/seed-demo-data.mjs
  ```

### 2. Create a fresh GM test user

The capture script reads credentials from `/tmp/gm-test-creds.txt`:

```bash
node scripts/create-gm-test-user.mjs
```

(Note: on Windows, Node's `/tmp` is the user temp dir — bash may not see it,
but the Node-based capture script reads it fine.)

### 3. Capture the screenshots

```bash
node scripts/capture-dashboard-screenshots.mjs
```

Outputs to `public/_screens/{dashboard|drivers|vehicles}-{light|dark}.png`.
The script logs in, dismisses the sidebar welcome notification, and waits for
data to load before each shot. It will not fail the whole run if one page
errors — re-run it to fill any gaps.

### 4. Verify no blank captures

```bash
node scripts/analyze-png.mjs public/_screens/*.png
```

A healthy dark capture has `avgLum` ≈ 19–25 and ~0% white; a light capture has
real content (`colorBuckets` well above 20). A near-100% white capture means
the page did not render — re-run the capture.

### 5. Publish with a NEW version suffix

```bash
NEXT=3   # bump to 3, 4, ... on every re-shoot (2 was the first publish)

# Back up the current published images first
mkdir -p public/_screens/old && cp public/dashboard-*-v*.png public/feature-*-v*.png public/_screens/old/

# Publish the new captures under the new suffix
cp public/_screens/dashboard-light.png public/dashboard-light-v${NEXT}.png
cp public/_screens/dashboard-dark.png  public/dashboard-dark-v${NEXT}.png
cp public/_screens/drivers-light.png   public/feature-1-light-v${NEXT}.png
cp public/_screens/drivers-dark.png    public/feature-1-dark-v${NEXT}.png
cp public/_screens/vehicles-light.png  public/feature-2-light-v${NEXT}.png
cp public/_screens/vehicles-dark.png   public/feature-2-dark-v${NEXT}.png

# Remove the superseded versions from public/ so no stale images linger
rm -f public/dashboard-*-v2.png public/feature-*-v2.png
```

### 6. Update the landing page srcs

In `src/app/landing/landing-page-content.tsx` (Showcase section), update the 6
`<Image src>` values to the new suffix (e.g. `/dashboard-light-v${NEXT}.png`, …).

### 7. Verify

```bash
curl -s http://localhost:3000/landing | grep -c "dashboard-light-v${NEXT}.png"   # expect ≥1
pnpm exec tsc --noEmit
```
