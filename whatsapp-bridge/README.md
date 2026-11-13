# Meridian WhatsApp bridge

A small program that stays logged in to WhatsApp on your PC. n8n posts the attendance message to it and it sends it to a **WhatsApp group** (or a single number).

## Start it (first time)
1. In this folder run `npm install`, then `npm start` (or double-click `start-bridge.bat`).
2. A QR code appears in the window. On your phone: WhatsApp > Settings > Linked devices > Link a device, and scan it.
3. The window says `connected as 92...`. Next time it logs in by itself (the login is kept in the `auth` folder - keep that folder private).

Use a number you can afford to risk: this is an unofficial link, like WhatsApp Web. Keep the volume low (a few messages per scan, never bulk).

## Check it
- Open http://127.0.0.1:3100/status in the browser - `"connected": true`.
- Open http://127.0.0.1:3100/groups - the exact names of your groups. The "Notification group" you type for a person in Meridian must match one of these names (capitals do not matter).

## Settings (optional)
Create a file called `.env` in this folder:
```
PORT=3100
BRIDGE_KEY=choose-a-secret        # n8n then sends it as header x-api-key
DEFAULT_TO=My Attendance Group    # used when a person has no group
COUNTRY_CODE=92                   # so 0300 1234567 works
```

## n8n
Use an **HTTP Request** node: POST `http://127.0.0.1:3100/send`, body fields `to` = `{{ $json.group }}` and `text` = `{{ $json.text }}`.
If n8n runs in Docker, use `http://host.docker.internal:3100/send` instead and set `HOST=0.0.0.0` in `.env` (and then set a `BRIDGE_KEY`).

## Troubleshooting
- "Not linked yet": scan the QR code in the window.
- "Logged out": delete the `auth` folder and start again.
- "No group called ...": copy the exact name from /groups.
