# Qromfort

Scan the code by your bed, tap what you need, and the care team sees it on a
color-coded board and gets a push alert. Part of the Holy Cross ED QR set
alongside Qrudos and yourERteam.

## Files

- `index.html` is the whole site: patient page and staff board, no build step.
- `api/requests.js` is the backend: one Vercel function, no dependencies.

## Setup (once)

1. Vercel project > Storage > Create Database > Upstash for Redis > connect it
   to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. Vercel project > Settings > Environment Variables, add:
   - `BOARD_PIN`: the staff PIN for the board. Six digits or more.
   - `NTFY_TOPIC`: the alert channel name, for example `qromfort-b4qmqk20n2lki1`.
     Treat it like a password: anyone who knows it can read the alerts.
3. Push the files. Vercel redeploys on its own. Environment variables only take
   effect on a deploy made after they were added.
4. On each staff phone: install the ntfy app, tap +, and subscribe to the same
   topic name.

Optional variables: `NTFY_TOKEN` (an ntfy account token, for higher limits)
and `NTFY_SERVER` (defaults to `https://ntfy.sh`).

## Links

| Who | Link |
| --- | --- |
| Patient in bed 12 | `https://qromfort.com/?room=12` |
| Patient in 42A | `https://qromfort.com/?room=42A` |
| Waiting room chair 3 | `https://qromfort.com/?room=C3` |
| Triage 1 | `https://qromfort.com/?room=T1` |
| Staff board | `https://qromfort.com/?view=board` |
| Prototype (this device only, nothing is sent) | `https://qromfort.com/?demo` |

Valid `room` values: `1` to `41`, `42A`, `42B`, `43A`, `43B`, `44` to `50`,
`C1` to `C5`, `T1`, `T2`. That is 59 QR codes. The bare address and any
unknown value show "Scan the code next to you to start."

## How it behaves

- A patient taps a request. It is saved, the board shows it within 10 seconds,
  and staff phones get one push ("Room 12", "Warm blanket").
- If the request cannot be sent, the patient is told so and asked to try again
  or tell a staff member. The page never shows a request as sent when it was not.
- The board asks for the PIN once per device and stays unlocked for 30 days.
  Changing `BOARD_PIN` signs every device out.
- If the board loses its connection it shows a red "Not connected" bar until it
  is back.
- Only the phone that made a request can cancel it. Staff can clear anything.
- Requests left open for 6 hours are dropped.

## Board colors

- Cyan: new, under 5 minutes
- Yellow: 5 to 10 minutes, or any bathroom request
- Red, flashing: over 10 minutes
- Green: someone tapped "On my way"

## Changing things

The room list and request list live in two places that must match: the CONFIG
block at the top of the script in `index.html`, and the config block at the
top of `api/requests.js`.

- `AREAS` / `ROOMS`: beds, chairs and triage rooms.
- `REQUESTS` / `TYPES`: what a patient can ask for. `floor: 1` starts a
  request at yellow. `notFor: ['chair']` hides it for that kind of place.
- `WAIT_AFTER`, `OVER_AFTER`: when a tile turns yellow and red.
- `POLL_BOARD`, `POLL_PATIENT`: how often screens check for changes.
- `T`: patient-facing text in English, Spanish, Haitian Creole and Portuguese.
  The translations have not been reviewed by native speakers yet.

## Limits to know about

- Database: each board check is one database command. One board left on all
  day at the 10-second setting is about 260,000 commands a month. Check that
  against the plan you are on.
- Alerts: ntfy caps messages per day on its free tier, and counts them per
  sender. Add `NTFY_TOKEN` from an ntfy account if alerts stop arriving.
- Abuse guards: at most 40 new requests per 5 minutes from one network, one
  push per room and item every 2 minutes, 10 wrong PINs per 10 minutes.

## Before real patients use it

- Test every code on hospital guest Wi-Fi, including the sign-in page it shows
  first.
- Have the Spanish, Creole and Portuguese text reviewed.
- The board uses one shared PIN. Move to individual sign-ins if you need to
  know who answered what.
- No overdue reminders yet: a request that turns red does not send a second
  push.
