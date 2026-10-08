# Citydle

Citydle is a daily geography guessing game. Use directional clues to identify a mystery city in six guesses or fewer. The game runs as a static site with vanilla HTML, CSS, and JavaScript; it has no build step or server dependency.

## How to play

- Everyone gets the same target city for a UTC calendar day.
- Enter a city name and submit it. Recognized guesses use one of six attempts; unknown and duplicate guesses do not.
- The clue board shows nearby reference cities and arrows pointing from the target toward those cities. Use the direction and the city names to narrow down the target.
- Optional hints add another directional clue, add a clue for a city on the target's continent, or reveal the distance from a guess. Each hint costs points; distance clues can be requested for additional guesses.
- A correct guess wins. After six incorrect guesses, the target is revealed.
- Your score starts at 1,000. Incorrect guesses and hints reduce it; the score never falls below zero.
- Game progress, result, hints, and score are saved in this browser and restored after a refresh. A new UTC day starts a new puzzle.
- An optional username can be saved with a completed result on this device.
- Use **Practice a random city** below the field guide to start a fresh scenario with six guesses and 1,000 points. Practice progress is saved separately; use the in-game return control to resume today's puzzle. The practice button selects a different city from the current target and previous practice target when possible.

## Project layout

```text
citydle/
|-- index.html
|-- styles.css
|-- app.js
|-- data/
|   `-- cities.json
`-- README.md
```

The app fetches `data/cities.json` at startup. Each city has a stable ID, display name, country, continent, latitude/longitude, and optional accepted aliases. Keep IDs unique, coordinates within valid ranges, and aliases unambiguous. The app normalizes case, whitespace, and diacritics when matching guesses. Puzzle selection sorts cities by ID and derives the daily index from the UTC date, so every player receives the same target without a server.

The bundled catalogue is a hand-curated starter dataset for the game prototype, not a comprehensive gazetteer. Before expanding or redistributing it, record the provenance and license of each data source here. Coordinates power the direction and distance clues, so review them when adding cities.

## Run locally

The city catalogue is loaded with `fetch`, so open the project through a local HTTP server rather than opening `index.html` as a `file://` URL. For example, with Python installed, run `python -m http.server 8000` from the repository directory and open `http://localhost:8000`.

No package installation or compilation is required.

## GitHub Pages

1. Push the repository to GitHub.
2. In the repository settings, open **Pages** and choose deployment from a branch.
3. Select the branch and folder containing `index.html` (the repository root for this layout), then save.
4. Open the published Pages URL and confirm the city data loads and a guess can be submitted.

All app and data paths are relative, which supports both root-hosted and project Pages URLs.

## Scores and privacy

The current version stores completed results only in the player's browser. A static GitHub Pages site cannot append results to a central file or safely hold write credentials. Central metrics require a separately hosted endpoint, such as a serverless function or Google Apps Script, with input validation and abuse controls. The client-side score submission hook should only be connected after that endpoint and its privacy policy are chosen; local results are not centrally collected.
