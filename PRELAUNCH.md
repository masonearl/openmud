# openmud pre-launch checklist

This checklist is the short operational view of the current pre-launch hardening work.

## North-star workflow

`Homepage -> sign in -> open desktop app -> set up sync -> open a project -> add task/chat -> reopen on another client and see the right state`

## Must-hold product rules

- Web and desktop sign-in must be reliable.
- Signing out or switching accounts must not leak old account state.
- Projects are cloud-canonical.
- Chats and tasks must reconcile predictably across clients.
- Desktop sync is mirror-based and non-destructive.
- Missing mirror files must not silently delete app documents.
- Users must be able to tell which features are:
  - cloud-backed
  - local cache
  - local-only
  - desktop-only

## Current pre-launch deliverables

- [x] Desktop auth handoff moved off raw token URLs
- [x] Web and desktop local state scoped by `user.id`
- [x] Project deletion is explicit and durable through the API
- [x] Project chat/task state sync uses a cloud-backed per-project state record
- [x] Desktop sync no longer deletes app documents on mirror absence
- [x] Auth flow documented
- [x] Sync ownership documented
- [x] QA checklist documented

## Release-blocking QA

- Sign in on web
- Sign in on desktop
- Sign out on web
- Sign out on desktop
- Switch between two accounts on one machine
- Delete a project and confirm it does not return
- Create/update a chat thread on one client and verify it on the other
- Create/update a task on one client and verify it on the other
- Set up desktop sync
- Add a file in openmud and verify it mirrors to disk
- Add a file on disk and verify it imports into openmud
- Remove a mirror file on disk and verify the openmud document is preserved
- Change the sync root and verify no project data is wiped
