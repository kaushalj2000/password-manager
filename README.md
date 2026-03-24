# PocketVault

PocketVault is a desktop password manager built with Electron and a file-based encrypted vault.

This app lets you:
- generate strong random passwords
- save new passwords
- save existing passwords
- store everything in an encrypted `.vault` file
- import passwords from Google Password Manager CSV exports
- export and import encrypted vault backups
- pin important entries to the top
- copy usernames/emails with one click
- auto-lock the vault after inactivity
- sync that encrypted vault file across devices with Google Drive, Dropbox, OneDrive, or similar services

## Why This Project Exists

This project was designed to avoid storing password data in browser storage or in a paid cloud backend.

Instead, it uses:
- a local encrypted vault file for permanent storage
- a master password for encryption and unlock
- a sync folder of your choice for cross-device access

That means your passwords stay in a file you control, while still being usable across multiple devices.

## How To Use

### First Time Setup

1. Download the latest Windows installer from the GitHub Releases page.
2. Install and open the app.
3. Click `Create New Vault File`.
4. Choose where to save your vault file.
5. If you want to use the same vault on multiple devices, save the `.vault` file inside a synced folder like Google Drive, Dropbox, or OneDrive.
6. Create a master password.
7. Start adding passwords or generate new ones inside the app.
8. Optionally choose an auto-lock timeout from the top bar after unlocking the vault.

### Opening Your Vault Later

1. Open the app.
2. Click `Open Existing Vault File`.
3. Select your existing `.vault` file.
4. Enter your master password.

### Using It On Another Device

1. Install the app on the other device.
2. Make sure your `.vault` file has synced to that device through Google Drive, Dropbox, or OneDrive.
3. Open the app.
4. Click `Open Existing Vault File`.
5. Select the same `.vault` file.
6. Enter the same master password.

### Important Tips

- Do not forget your master password.
- Do not upload your `.vault` file to GitHub.
- Wait for your sync service to finish before opening the vault on another device.
- Avoid editing the same vault on two devices at the same time.
- Export encrypted backups regularly if you want an extra recovery copy.

### Importing From Google Password Manager

1. Export your passwords from Google Password Manager as a CSV file.
2. Open and unlock your vault in this app.
3. Click `Import Google Passwords`.
4. Select the Google CSV file.
5. The app imports valid rows into your encrypted vault and skips exact duplicates.

### Backup And Restore

1. Open and unlock your vault.
2. Click `Export Backup` to save an encrypted backup copy of the vault.
3. Click `Import Backup` if you want to load a previously exported encrypted backup into the current vault.
4. Backups must use the same master password as the currently unlocked vault.

## Features

- Electron desktop app for Windows and Mac
- Native open/save dialogs for vault files
- AES-GCM encrypted vault data
- PBKDF2-based key derivation from a master password
- Password generator with configurable length and character types
- Search, edit, reveal, copy, pin, and delete saved entries
- One-click copy for usernames/emails
- Import from Google Password Manager CSV export
- Encrypted backup export and import
- Auto-lock timer with warning countdown and persistent preference
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
- GitHub Releases publishing workflow
- True in-app auto-update support
- Android/mobile companion app using the same vault format
