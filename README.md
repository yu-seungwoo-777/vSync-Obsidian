# vSync

Real-time file synchronization plugin for [Obsidian](https://obsidian.md). Sync your vault with a self-hosted **Vector** server.

## Features

- **Real-time sync** via WebSocket or periodic polling
- **Offline support** with persistent queue - changes are synced when connection is restored
- **3-way conflict resolution** with visual diff UI
- **Binary file support** for images, PDFs, and other non-text files
- **Multi-device sync** with device identification and JWT session management
- **Hash-based deduplication** to avoid unnecessary transfers
- **Conflict queue panel** to review and resolve conflicts at your own pace
- **Sync log viewer** for monitoring synchronization activity
- **Server-side search** to find files across your vault from the server

## Requirements

- A running [Vector](https://github.com/yu-seungwoo-777/vSync) sync server
- Obsidian 1.0.0 or later

## Installation

### From Obsidian Community Plugins (Recommended)

1. Open Obsidian Settings
2. Go to **Community plugins** and turn on community plugins
3. Search for **vSync** and click **Install**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/yu-seungwoo-777/vsync-obsidian/releases)
2. Create a folder named `vsync` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable vSync in **Settings > Community plugins**

## Setup

1. Open Obsidian Settings and navigate to **vSync**
2. Click **Connect** and enter your Vector server URL, username, and password
3. After successful connection, toggle **Sync enabled** to start synchronization
4. Choose your preferred connection mode:
   - **Realtime**: WebSocket-based instant sync (recommended)
   - **Polling**: Periodic sync at a configurable interval

## Connection Modes

| Mode | Description | Best for |
|------|-------------|----------|
| Realtime | WebSocket connection for instant bidirectional sync | Always-on devices, multi-device workflows |
| Polling | Periodic HTTP polling at configurable intervals | Battery-constrained devices, unstable networks |

## Conflict Resolution

When the same file is modified on multiple devices simultaneously, vSync detects the conflict and:

1. Adds the file to the **Conflict Queue** panel
2. Shows a visual diff between local and server versions
3. Lets you choose: keep local, keep server, or merge manually

Access the conflict queue from the ribbon icon or command palette.

## Development

### Prerequisites

- Node.js 20+
- npm

### Build

```bash
npm install
npm run build
```

### Development with Hot Reload

```bash
npm run dev
```

### Testing

```bash
npm test
```

### Type Checking

```bash
npm run typecheck
```

## Architecture

```
src/
  main.ts          Plugin entry point and lifecycle
  sync-engine.ts   Core synchronization engine
  api-client.ts    Server API communication
  conflict.ts      Conflict detection and resolution
  settings.ts      Plugin settings UI
  types.ts         TypeScript type definitions
  adapters/        API abstraction layer
  services/        Business logic services
  ui/              Modal and view components
  utils/           Utility functions
```

## License

MIT
