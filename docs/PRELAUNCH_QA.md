# openmud pre-launch QA matrix

Use this checklist before public promotion.

## 1. Sign-in

### Web
- Open `/welcome`
- Sign in with magic link
- Sign in with Google
- Confirm redirect back into openmud
- Confirm the account email is correct

### Desktop
- From a signed-in browser, click **Open openmud**
- Confirm the desktop app opens
- Confirm desktop sign-in completes without a raw token URL
- Confirm the correct account email appears in the app

## 2. Sign-out

### Web
- Sign out from `/try`
- Sign out from `/settings`
- Confirm projects, chats, tasks, provider keys, and account UI no longer show the previous account

### Desktop
- Sign out in the desktop app
- Confirm desktop storage switches back to anonymous state

## 3. Account switching

- Sign in as Account A
- Create or load distinct project/task/chat state
- Sign out
- Sign in as Account B
- Confirm Account A state is not visible
- Switch back to Account A
- Confirm Account A state returns intact

Run this sequence across:
- web only
- desktop only
- web then desktop
- desktop then web

## 4. Projects

- Create a project
- Rename a project
- Delete a project
- Reload the app
- Reopen another client
- Confirm deleted projects do not resurrect

## 5. Chats and tasks

- Create multiple chat threads in one project
- Add messages in a non-default thread
- Switch clients and confirm the correct thread state appears
- Add and complete tasks
- Switch clients and confirm task state matches

## 6. Desktop sync

- Set up the sync root
- Confirm the mirror folder is created
- Upload a document in openmud and confirm it appears in the mirror
- Add a file in the mirror and confirm it imports into openmud
- Edit a mirrored file and confirm the app copy updates
- Remove a file from the mirror and confirm the openmud document is preserved
- Change the sync root and confirm project data is not wiped

## 7. Failure visibility

- Force a failed desktop handoff and confirm the UI shows a useful error
- Force a failed sync action and confirm the error is visible
- Check logs for structured auth/handoff/sync events
