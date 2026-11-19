# PartsBin

Records what electronic parts you have and where they are: room > rack > shelf > box. Photograph a
bag label to add a part, search by part number, value or description, and see the full path to
the box. Runs as a desktop app (Tauri) and an iPhone app (Capacitor) from one codebase. Data lives
on the device and syncs through a folder in your own Google Drive, Dropbox or Box.

## Run it

```sh
npm install
npm run dev            # browser preview at http://localhost:5173 (no cloud sign-in)
npm run desktop        # desktop app, with live reload
npm run desktop:build  # installable desktop app in src-tauri/target/release/bundle
npm run ios            # build, copy into the Xcode project, open Xcode
npm test               # unit tests
```

The desktop app needs Rust (`rustup`). The iPhone app needs Xcode and CocoaPods.

### Install on your iPhone

1. `npm run ios` opens Xcode.
2. Select the **App** target > **Signing & Capabilities** > choose your Apple ID as the team.
3. Plug in the iPhone, choose it as the run destination, press Run.
4. First launch only: on the phone, Settings > General > VPN & Device Management > trust your
   developer certificate.

With a free Apple ID the app stops opening after 7 days until you press Run again; your data is
kept. A paid developer account removes that limit.

The iPhone simulator on Apple-silicon Macs needs Rosetta, because Google ML Kit (used for barcode
and text recognition) ships no arm64 simulator build. A real iPhone is not affected.

## One-time setup

Everything below is entered in the app under **Settings**. Keys and sign-ins are stored in the
device keychain and are never synced, so enter them on each device.

### Storage

PartsBin signs in with an app registration that belongs to you. Pick one service; you can move
later (Settings > Move library here).

**Google Drive** ([console](https://console.cloud.google.com/apis/credentials))

1. Create a project. APIs & Services > Library > enable **Google Drive API**.
2. OAuth consent screen: user type External; fill in the app name and your email. Then set
   Publishing status to **In production**. (In "Testing", Google expires the sign-in every 7 days.)
3. Credentials > Create credentials > OAuth client ID > **Desktop app**. Enter its client ID and
   client secret in the desktop app.
4. For the iPhone: Create credentials > OAuth client ID > **iOS**, bundle ID `com.wfang.partsbin`.
   Enter its client ID in the iPhone app. Use the same project for both, so both apps see the
   same files.

Files appear in My Drive > PartsBin. PartsBin can only see files it created itself.

**Dropbox** ([console](https://www.dropbox.com/developers/apps))

1. Create app > Scoped access > **App folder**.
2. Permissions tab: enable `files.metadata.read`, `files.content.read`, `files.content.write`.
3. Settings tab > Redirect URIs: add `http://localhost:53127/oauth2redirect` (desktop) and
   `com.wfang.partsbin:/oauth2redirect` (iPhone).
4. Enter the **App key** in the app.

Files appear in Dropbox > Apps > (your app name) > PartsBin.

**Box** ([console](https://app.box.com/developers/console))

1. Create Platform App > Custom App > User Authentication (OAuth 2.0).
2. Configuration: add the same two redirect URIs as for Dropbox, and enable "Write all files and
   folders stored in Box".
3. Enter the client ID and client secret in the app.

### Part lookup (optional)

Fills in description, specifications and datasheet link from a part number.

- **Digi-Key**: [developer.digikey.com](https://developer.digikey.com/) > create an organization
  and a Production app with the **Product Information V4** API. Enter the client ID and secret.
- **Mouser**: request a **Search API** key at [mouser.com/api-search](https://www.mouser.com/api-search/).

### AI (optional)

Enter an OpenAI API key, press "Load model list" and choose a model that accepts images. It is
used only for "Read with AI" on a label photo and "Ask AI" in search.

## How the data is stored

Each device keeps a full copy in its own database and works offline. The cloud folder holds:

```
manifest.json            identifies the library
logs/<device>/N.jsonl    changes made on each device, append-only
snapshots/<time>.json    full state, written now and then so old logs can be removed
blobs/<sha256>.jpg       photos
```

Devices merge each other's changes field by field; the newest edit of a field wins. Nothing on
the storage service runs code, which is why any plain file storage works and why moving between
services is a verified file copy.

"Save a backup" in Settings writes the same structure as one zip file.

## Layout

```
src/domain    parts, places, stock, projects and the actions on them
src/db        local database and the change log
src/sync      sync engine, storage providers, OAuth, migration, zip backup
src/scan      camera, barcode and text recognition, label parsers
src/enrich    Digi-Key and Mouser lookup
src/ai        OpenAI client, label reading, questions about the inventory
src/import    KiCad BOM and order-history CSV
src/platform  what differs between desktop, iPhone and browser
src/ui        screens
src-tauri     desktop shell (keychain, OAuth redirect listener)
ios           iPhone shell
```
