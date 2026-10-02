# RedreviArchive

A lightweight, dedicated archive viewer for **@redrevi_VRC**.

The application is intentionally locked to a single public X account. It does not embed the X website, expose a general account search, or require the client to know the API Bearer Token.

## What is included

- Reverse-chronological archive feed.
- Local archive storage in `data/archive.json`.
- X API sync with pagination.
- Image/video media previews.
- Server-side video streaming/download endpoint when X exposes a downloadable video variant.
- Local saved-posts list.
- Responsive PWA UI for desktop, Android and Raspberry Pi browsers.
- Very small dependency footprint: Node.js built-ins only.

## Requirements

- Node.js 20+.
- An X developer project/app and a Bearer Token with access to the needed X API endpoints.
- Network access from the machine running the archive server.

X currently documents the user-posts timeline at `GET /2/users/:id/tweets`, including pagination and up to 3,200 of a user's most recent posts. For a genuinely complete archive, set `X_FULL_ARCHIVE=true` when your API access includes Full-Archive Search; X documents that endpoint as available to pay-per-use and Enterprise customers. Full-Archive Search uses the fixed query `from:redrevi_VRC -is:retweet -is:reply`. See the official X API docs before enabling regular syncs.

## Setup

1. Copy `.env.example` to `.env`.
2. Put the X Bearer Token in `X_BEARER_TOKEN`.
3. Run:

```bash
npm start
```

4. Open `http://localhost:3000`.

### Full archive mode

By default the project uses the user-posts timeline and caps the local archive at 3,200 posts. To use the complete X archive instead, set:

```env
X_FULL_ARCHIVE=true
SYNC_MAX_PAGES=32
```

The full-archive endpoint can return up to 500 posts per request. Keep the page count sensible because X's current API is pay-per-use.

### Raspberry Pi 3B

On the Pi, bind to `0.0.0.0` (the default in this project), then open the Pi's LAN address from another device, for example:

```text
http://PI_ADDRESS:3000
```

That makes the Pi the central archive server while Windows/Android simply use the same UI over the network.

## Important

The archive server stores only metadata and media URLs returned by the X API until a video is requested for download. Respect X's current developer terms, content rights, and any applicable restrictions when storing or redistributing media.

## Next milestones

- Electron desktop packaging for Windows.
- Capacitor Android packaging.
- Optional automatic scheduled sync on the Pi.
- Better download queue with progress.
- Archive export/import.
