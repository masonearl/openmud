# openmud auth flow

This document describes the intended sign-in, sign-out, and desktop handoff behavior for pre-launch.

## Goals

- No raw session tokens in desktop handoff URLs
- No stale account state after sign-out
- No cross-account leakage on shared machines

## Web sign-in

1. The browser signs in through Supabase using:
   - magic link
   - Google
   - Apple
2. The client stores the authenticated session through Supabase.
3. openmud scopes account-bound local state by `user.id`.
4. The web app then loads the current user's cloud-backed project state.

## Desktop handoff

1. A signed-in browser calls `POST /api/desktop-handoff/start`.
2. The API validates the authenticated user and stores an encrypted, short-lived handoff record.
3. The browser opens the desktop app with:

   `openmud://auth?handoff=<opaque_code>`

4. The desktop renderer redeems that code with `POST /api/desktop-handoff/redeem`.
5. The API returns the session tokens over HTTPS.
6. The renderer restores the Supabase session locally with `setSession(...)`.

## Why this is safer

- The URL no longer carries raw `access_token` and `refresh_token` values.
- The handoff code is opaque.
- The code is short-lived.
- The code is consumed on redeem.

## Sign-out

On sign-out:

- Supabase session is cleared
- openmud switches local storage scope back to the anonymous namespace
- account-bound local state is no longer visible
- the desktop app storage scope is reset to `anon`

## Account switching

On account switch:

- web local state is read from the new user's scoped namespace
- desktop JSON storage switches to the new user's scoped directory
- cloud-backed projects and project state load for the new account only

## Account-bound local state

The following data is scoped by `user.id`:

- projects cache
- active project / active chat
- chat thread data
- project task/project state cache
- subscription/account metadata
- provider keys
- relay token
- company profile and logo
- desktop sync enabled flag
- per-account document IndexedDB namespace
