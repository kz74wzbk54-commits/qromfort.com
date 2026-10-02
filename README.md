# Qromfort

Scan the code by your bed, tap what you need, and the care team sees it on a
color-coded board. Part of the Holy Cross ED QR set alongside Qrudos and
yourERteam.

## Status

Front end only. Requests are kept in the browser that made them
(`localStorage`), so a phone and the station screen do not see each other yet.
The whole data layer is the `store` object near the top of the script in
`index.html`; the backend replaces the inside of that object and nothing else.

## Files

- `index.html` is the entire site: patient page and staff board, no build step.

## Deploy

Import the repo in Vercel with the framework preset set to "Other" and no
build command, then point qromfort.com at the project.

## Links

| Who | Link |
| --- | --- |
| Patient in bed 12 | `https://qromfort.com/?room=12` |
| Patient in 42A | `https://qromfort.com/?room=42A` |
| Waiting room chair 3 | `https://qromfort.com/?room=C3` |
| Triage 1 | `https://qromfort.com/?room=T1` |
| Staff board | `https://qromfort.com/?view=board` |
| Prototype with the screen switcher | `https://qromfort.com/` |

Valid `room` values: `1` to `41`, `42A`, `42B`, `43A`, `43B`, `44` to `50`,
`C1` to `C5`, `T1`, `T2`. That is 59 QR codes. An unknown value shows
"Scan the code next to you to start."

## Changing things

Everything is in the CONFIG block at the top of the script:

- `AREAS` is the list of beds, chairs and triage rooms.
- `REQUESTS` is what a patient can ask for. `floor: 1` makes a request start at
  yellow (bathroom help does). `notFor: ['chair']` hides it for that kind of
  place (lights are hidden for chairs).
- `WAIT_AFTER` and `OVER_AFTER` set when a tile turns yellow and red
  (5 and 10 minutes).
- `T` holds the patient-facing text in English, Spanish, Haitian Creole and
  Portuguese. The translations have not been reviewed by native speakers yet.

## Board colors

- Cyan: new, under 5 minutes
- Yellow: 5 to 10 minutes, or any bathroom request
- Red, flashing: over 10 minutes
- Green: someone tapped "On my way"

## Before real patients use it

- Build the backend so requests reach the board and staff phones.
- Put the board behind a sign-in. Right now anyone with the link can open it.
- Limit how often one code can send requests.
- Have the Spanish, Creole and Portuguese text reviewed.
