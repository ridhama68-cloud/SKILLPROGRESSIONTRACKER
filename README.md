# Steady habit and skill tracker

Open `index.html` in a browser to use the current prototype. The workspace saves its records and compressed photo submissions in that browser's local storage.

## Included

- Add and remove recurring practices from the Admin panel.
- Add named user records in the Admin panel.
- Attach a photo to a daily task check-in and review submissions in the Admin panel.
- Track binary completion or a numeric value, with higher or lower values marked as progress.
- View rolling completion reports, improvement trends, and coaching notes.

## Before inviting other people

This is a local prototype, not a shared multi-user service. User records are labels only; there is no sign-in or access control. Each browser has separate data. Photo uploads stay in browser storage. The AI photo-check button is a placeholder because this build has no vision model or secure server connection.

To offer it to other users, deploy a backend with authentication, shared storage, per-user permissions, image storage, and a server-side vision check. Do not put an AI provider key in this static app. After that backend is configured, the static UI can be hosted from GitHub Pages or another static host.
