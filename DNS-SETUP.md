# Rockmud.com → Vercel DNS Setup

Your site is deployed. **One manual step left:** point the domain to Vercel.

Your nameservers are **Google Domains** (`ns-cloud-b1.googledomains.com`, etc.). Use the same place where you manage rockmud.com (e.g. Google Domains / Google Cloud Domains, or wherever you see those nameservers).

---

## Records to add

In your DNS provider for **rockmud.com**, add these two records:

| Type | Name / Host | Value / Points to | TTL |
|------|-------------|-------------------|-----|
| **A** | `@` (or leave blank for root) | `76.76.21.21` | 3600 or default |
| **A** | `www` | `76.76.21.21` | 3600 or default |

- **Root (rockmud.com):** A record, name `@` or blank, value **76.76.21.21**
- **www (www.rockmud.com):** A record, name **www**, value **76.76.21.21**

Save, then wait 5–60 minutes (sometimes up to 24–48 hours). Vercel will verify and can email you when the domain is active.

---

## Where to do this

- **Google Domains / Google Cloud Domains:** Domain → DNS → Custom records (or “Manage custom records”) → Add the two A records above.
- **Cloudflare:** DNS → Add record (A for `@`, A for `www`).
- **Namecheap, GoDaddy, etc.:** DNS / Advanced DNS → Add A record for root and for `www`.

---

## Links

- **Live site (Vercel URL):** https://rockmud-2u1st80az-buildmase.vercel.app  
- **Vercel project:** https://vercel.com/buildmase/rockmud.com  
- **GitHub repo:** https://github.com/masonearl/rockmud  

After DNS propagates, https://rockmud.com and https://www.rockmud.com will serve the site.
