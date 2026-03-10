# openmud sync ownership model

This document defines the source of truth for early public release.

## Canonical ownership

### Account identity
- **Cloud canonical**

### Projects
- **Cloud canonical**
- Local web/desktop records are caches

### Chats
- **Cloud canonical**
- Stored in the per-project state record
- Local copies are caches

### Tasks
- **Cloud canonical**
- Stored in the per-project state record
- Local copies are caches

### Documents
- **Local app canonical**
- Stored in the browser's per-user IndexedDB namespace
- Not yet treated as full cloud-canonical assets

### Desktop mirror folder
- **Mirror-only**
- Used for local filesystem workflows
- Not allowed to delete the app copy just because a file is missing

### Project RAG index
- **Derived data**
- Built from documents and imported text
- Not the source of truth for the underlying files

## Sync rules

## Projects

- Create/update goes to the cloud project record
- Delete is explicit through the projects API
- Missing local cache does not mean delete

## Chats and tasks

- Synced as per-project cloud state
- The client treats cloud state as authoritative across devices
- Local edits debounce into cloud updates

## Desktop sync

- openmud mirrors project documents out to the desktop folder
- openmud imports desktop edits back in
- openmud does **not** treat mirror absence as a delete command
- Explicit destructive actions require explicit user intent:
  - deleting the project
  - deleting a document inside openmud

## User mental model

- Use the web app for account, cloud projects, hosted models, and synced chat/task state.
- Use the desktop app when you need:
  - local folder sync
  - local file access
  - desktop-linked automations
- The mirror folder is a working copy, not the authority for deleting project documents.
