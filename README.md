# BetterDay

## Project Owners

- **Name:** Ryan
- **Role:** Driver

- **Name:** Triston
- **Role:** Designer

- **Name:** Matteo
- **Role:** Tester

## About BetterDay

Your better day starts now. BetterDay creates a repeating weekly routine around your sleep, fixed commitments, and up to three personal activities.

This first version uses plain HTML, CSS, and JavaScript. It needs no build step, account, database, API key, or external service.

## Website

GitHub Pages: **https://rspidal.github.io/betterday/**

GitHub Pages publishes the root of the `main` branch. Pushing changes to `main` triggers a new deployment; the Actions tab shows its progress. The `.nojekyll` file serves the existing HTML, CSS, and JavaScript directly.

## Run locally

Open Terminal and run:

```sh
cd /Users/matteobotelho/Desktop/BetterDay
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://127.0.0.1:8080** in your browser. Press **Control+C** in Terminal to stop the server. Teammates should use the location of their own checkout in the `cd` command.

Serve the folder over HTTP rather than opening `index.html` directly, because the JavaScript uses modules. If Python is unavailable, any local static server works. Node users can also run `npm start` when Python is installed.

## Pages and behavior

- **Home:** introduces the app. After a schedule is created, the main button opens the saved schedule.
- **Questionnaire:** four steps for daily rhythm, fixed commitments, personal activities, and review. Unfinished answers are saved as you go.
- **My schedule:** week and day views, with controls to add, edit, and delete individual event occurrences. Overlapping events and events during sleep are rejected.
- **Retake questionnaire:** starts a new questionnaire with the option to keep current fixed commitments, including edits made on the calendar. The old schedule remains available until its replacement is generated.

## Scheduling rules

The scheduler preserves sleep and fixed commitments, places activities in priority order, respects available days, and tries preferred times first. Suggested activities have 10-minute transition gaps from other events; manual edits can reduce those gaps. Activities that cannot fit are listed instead of being silently shortened or omitted. Unused time stays open.

The first version supports a repeating Monday-Sunday week. For events crossing midnight, add a separate block for each day. Use midnight as an end time for the end of the selected day.

Answers, drafts, and schedules are saved using browser local storage under `betterday.v1`. Data stays in that browser on that device and origin (address and port); it does not sync across devices. Clearing browser data removes it. Private browsing or storage restrictions may prevent saving, in which case the app displays a warning.

## Project files

- `index.html` and `styles.css`: shared shell and responsive visual design.
- `js/app.js`: navigation, home, calendar, event management, and questionnaire restart.
- `js/questionnaire.js`: questionnaire steps and field interactions.
- `js/scheduler.js`: pure scheduling and validation functions.
- `js/storage.js`: local persistence and saved-data recovery.
- `docs/questionnaire.md`: questionnaire outline.
- `BetterdayC.pdf`: original project brief.

Storage, scheduling, and UI are separate modules so a backend can be added later.

## Tests

With a current Node.js installation:

```sh
npm test
```

No dependency installation is required. Tests cover schedule collisions, sleep, day overrides, midnight, priority, unavailable sessions, event validation, and saved-data recovery.
