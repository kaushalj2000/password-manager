# Password Manager

Desktop password manager built with Electron and a file-based encrypted vault.

This app lets you:
- generate strong random passwords
- save new passwords
- save existing passwords
- store everything in an encrypted `.vault` file
- sync that encrypted vault file across devices with Google Drive, Dropbox, OneDrive, or similar services

## Why This Project Exists

This project was designed to avoid storing password data in browser storage or in a paid cloud backend.

Instead, it uses:
- a local encrypted vault file for permanent storage
- a master password for encryption and unlock
- a sync folder of your choice for cross-device access

That means your passwords stay in a file you control, while still being usable across multiple devices.

## Features

- Electron desktop app for Windows and Mac
- Native open/save dialogs for vault files
- AES-GCM encrypted vault data
- PBKDF2-based key derivation from a master password
- Password generator with configurable length and character types
- Search, edit, reveal, copy, and delete saved entries
- Sync-friendly `.vault` file workflow

## How It Works

1. Create a new `.vault` file or open an existing one.
2. Set a master password.
3. The app encrypts your vault contents before writing them to disk.
4. Save the `.vault` file inside a synced folder like Google Drive.
5. Open the same vault file on another device and unlock it with the same master password.

## Tech Stack

- Electron
- HTML
- CSS
- JavaScript
- Web Crypto API

## Local Development

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm start
```

Build the app:

```bash
npm run build
```

Create an unpacked desktop build:

```bash
npm run dist
```

## Important Notes

- Do not commit your real `.vault` file to Git.
- Do not forget your master password. This app does not provide recovery.
- Avoid editing the same vault file on multiple devices at the same time before sync completes.
- This project currently builds the Windows installer on Windows. Mac packaging should be run on a Mac.

## Repo Safety

The repository is configured to ignore:
- `node_modules/`
- `dist/`
- `*.vault`

So your encrypted vault file and generated app builds are not accidentally committed.

## Future Improvements

- Custom app icon
- Windows and Mac release installers
- GitHub Releases publishing workflow
- Optional backup and restore flow
- Android/mobile companion app using the same vault format
