# Rockmud.com DNS on Squarespace → point to Vercel

You’re on: **Squarespace Domains — rockmud.com — DNS Settings**

Do this so **rockmud.com** and **www.rockmud.com** point to Vercel.

---

## Step 1: Fix the root domain (rockmud.com)

Squarespace Defaults currently has several **A** records for `@` pointing to Squarespace. We need Vercel’s A record instead.

**Option A – If you can edit Squarespace Defaults**

- Delete the existing **A** records for host **@** (the four with IPs like 198.49.23.144, 198.185.159.144, etc.).
- Then add one **A** record:
  - **Host:** `@`
  - **Type:** `A`
  - **Data:** `76.76.21.21`
  - **TTL:** leave default (e.g. 4 hrs).

**Option B – If Defaults can’t be edited (use Custom records)**

1. Scroll to **Custom records**.
2. Click **ADD RECORD**.
3. Set:
   - **Host:** `@`
   - **Type:** `A`
   - **Priority:** `0` (or leave blank)
   - **Data:** `76.76.21.21`
4. Save.
5. If Squarespace still shows “No custom records” or doesn’t list your record, check whether you must remove the default A records for `@` first (some setups only use Custom for extra records).

---

## Step 2: Fix www (www.rockmud.com)

Squarespace Defaults has **www** as a **CNAME** to `ext-sq.squarespace.com`. We need **www** to point to Vercel.

**Option A – Edit Squarespace Defaults**

- Delete the **CNAME** for host **www**.
- Add one **A** record:
  - **Host:** `www`
  - **Type:** `A`
  - **Data:** `76.76.21.21`
  - **TTL:** default.

**Option B – Custom records**

1. In **Custom records**, click **ADD RECORD**.
2. Set:
   - **Host:** `www`
   - **Type:** `A`
   - **Priority:** `0` (or blank)
   - **Data:** `76.76.21.21`
3. Save.

(If Squarespace still resolves www to Squarespace, remove the default **www** CNAME so your custom A record is used.)

---

## Summary – two records for Vercel

| Type | Host | Data        |
|------|------|-------------|
| **A** | `@`  | `76.76.21.21` |
| **A** | `www` | `76.76.21.21` |

After saving, wait a few minutes (up to an hour). Then check:

- https://rockmud.com  
- https://www.rockmud.com  

Vercel will verify the domain; you may get an email when it’s active.
