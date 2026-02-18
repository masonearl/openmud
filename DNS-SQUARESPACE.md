# Fix “Invalid Configuration” – point rockmud.com to Vercel

Vercel shows **Invalid Configuration** because DNS still points to **Squarespace**. Fix it in Squarespace (no change needed in Vercel).

**Squarespace DNS:** https://account.squarespace.com/domains/managed/rockmud.com/dns/dns-settings

---

## 1. Remove Squarespace defaults (so Vercel can take over)

In the **“Squarespace Defaults”** table at the top:

- Click the **trash** icon and delete **all four A records** for host **@** (IPs 198.49.23.144, 198.49.23.145, 198.185.159.144, 198.185.159.145).
- Click the **trash** icon and delete the **CNAME** for host **www** (the one pointing to `ext-sq.squarespace.com`).

Save if there’s a Save button.

---

## 2. Add Vercel’s records (Custom records)

Scroll to **“Custom records”** and click **ADD RECORD**.

**Record 1 – root domain (rockmud.com)**

- **Host:** `@`
- **Type:** `A`
- **Data (or “Points to”):** `76.76.21.21`
- **Priority:** 0 or leave blank  
- **TTL:** default (e.g. 4 hrs)

Save / Add.

**Record 2 – www (www.rockmud.com)**

Click **ADD RECORD** again.

- **Host:** `www`
- **Type:** `A`
- **Data (or “Points to”):** `76.76.21.21`
- **Priority:** 0 or leave blank  
- **TTL:** default

Save.

---

## 3. Wait and recheck

- Wait **5–15 minutes** (up to an hour).
- In Vercel → **Domains**, click **Refresh** next to rockmud.com and www.rockmud.com. They should switch to **Valid Configuration**.
- Open https://rockmud.com and https://www.rockmud.com to confirm.

**Copy-paste:** both records use **Data:** `76.76.21.21` (Vercel’s IP).
