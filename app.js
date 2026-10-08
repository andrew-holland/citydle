"use strict";

const STARTING_SCORE = 1000;
const MAX_GUESSES = 6;
const SCORE_COSTS = { incorrectGuess: 100, arrow: 75, continentArrow: 125, distance: 125 };
const INITIAL_ARROW_COUNT = 3;
const STATE_VERSION = 2;
const STATE_PREFIX = "citydle-state-v2-";
const PRACTICE_STATE_KEY = "citydle-practice-v1";
const RESULTS_KEY = "citydle-results-v1";
const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const DIRECTION_ARROWS = { N: "\u2191", NE: "\u2197", E: "\u2192", SE: "\u2198", S: "\u2193", SW: "\u2199", W: "\u2190", NW: "\u2196" };

const elements = {
  date: document.querySelector("#puzzle-date"),
  score: document.querySelector("#score-value"),
  guessesLeft: document.querySelector("#guesses-left"),
  attemptCount: document.querySelector("#attempt-count"),
  board: document.querySelector("#clue-board"),
  form: document.querySelector("#guess-form"),
  input: document.querySelector("#city-guess"),
  suggestions: document.querySelector("#city-suggestions"),
  formMessage: document.querySelector("#form-message"),
  hintMessage: document.querySelector("#hint-message"),
  hintButtons: [...document.querySelectorAll("[data-hint]")],
  guessList: document.querySelector("#guess-list"),
  resultPanel: document.querySelector("#result-panel"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultDetail: document.querySelector("#result-detail"),
  usernameForm: document.querySelector("#username-form"),
  username: document.querySelector("#username"),
  saveMessage: document.querySelector("#save-message"),
  practiceButton: document.querySelector("#practice-button"),
  practiceBanner: document.querySelector("#practice-banner"),
  dailyModeButton: document.querySelector("#daily-mode-button"),
};

let cities = [];
let cityById = new Map();
let cityByName = new Map();
let target = null;
let state = null;

function normalizeName(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function getPuzzleDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getDailyTarget(cityList, dateKey) {
  const ordered = [...cityList].sort((left, right) => left.id.localeCompare(right.id));
  let hash = 2166136261;
  for (const character of dateKey) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ordered[(hash >>> 0) % ordered.length];
}

function getRandomTarget(cityList, excludedIds = []) {
  const excluded = new Set(excludedIds);
  let candidates = cityList.filter((city) => !excluded.has(city.id));
  if (candidates.length === 0) candidates = cityList;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function createRoundId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getBearing(from, to) {
  const radians = Math.PI / 180;
  const latitude1 = from.latitude * radians;
  const latitude2 = to.latitude * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2) - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function getDirection(degrees) {
  return DIRECTIONS[Math.round(degrees / 45) % DIRECTIONS.length];
}

function getDistanceKm(first, second) {
  const radians = Math.PI / 180;
  const latitudeDelta = (second.latitude - first.latitude) * radians;
  const longitudeDelta = (second.longitude - first.longitude) * radians;
  const latitude1 = first.latitude * radians;
  const latitude2 = second.latitude * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateCityData(payload) {
  if (!payload || !Array.isArray(payload.cities) || payload.cities.length < 2) {
    throw new Error("The city data is missing or has too few entries.");
  }
  const ids = new Set();
  const names = new Map();
  for (const city of payload.cities) {
    if (!city || typeof city.id !== "string" || typeof city.name !== "string" || typeof city.country !== "string" || typeof city.continent !== "string" || !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude) || Math.abs(city.latitude) > 90 || Math.abs(city.longitude) > 180 || (city.aliases !== undefined && !Array.isArray(city.aliases))) {
      throw new Error("The city data contains an invalid record.");
    }
    if (ids.has(city.id)) throw new Error(`Duplicate city ID: ${city.id}`);
    ids.add(city.id);
    for (const name of [city.name, ...(city.aliases || [])]) {
      const normalized = normalizeName(name);
      if (!normalized || (names.has(normalized) && names.get(normalized) !== city.id)) throw new Error(`City names and aliases must be unique across cities: ${name}`);
      names.set(normalized, city.id);
    }
  }
  return payload.cities;
}

function makeInitialState(dateKey, puzzleCity, mode = "daily") {
  const references = cities.filter((city) => city.id !== puzzleCity.id)
    .map((city) => ({ city, direction: getDirection(getBearing(puzzleCity, city)), distance: getDistanceKm(puzzleCity, city) }))
    .sort((left, right) => left.distance - right.distance);
  const selected = [];
  const usedDirections = new Set();
  for (const reference of references) {
    if (!usedDirections.has(reference.direction)) {
      selected.push(reference.city.id);
      usedDirections.add(reference.direction);
      if (selected.length === INITIAL_ARROW_COUNT) break;
    }
  }
  for (const reference of references) {
    if (selected.length === INITIAL_ARROW_COUNT) break;
    if (!selected.includes(reference.city.id)) selected.push(reference.city.id);
  }
  return {
    version: STATE_VERSION,
    dateKey,
    mode,
    roundId: createRoundId(),
    targetId: puzzleCity.id,
    guesses: [],
    arrowIds: selected,
    hints: { distanceGuessIds: [] },
    score: STARTING_SCORE,
    status: "playing",
  };
}

function isValidState(saved, dateKey, puzzleCity, mode = "daily") {
  if (!saved || saved.version !== STATE_VERSION || saved.dateKey !== dateKey || (saved.mode || "daily") !== mode || (saved.roundId !== undefined && typeof saved.roundId !== "string") || saved.targetId !== puzzleCity.id || !Array.isArray(saved.guesses) || !Array.isArray(saved.arrowIds) || !saved.hints || !Array.isArray(saved.hints.distanceGuessIds) || !Number.isFinite(saved.score) || !["playing", "won", "lost"].includes(saved.status)) return false;
  if (saved.guesses.length > MAX_GUESSES || saved.score < 0 || saved.score > STARTING_SCORE) return false;
  const guessIds = new Set();
  for (const guess of saved.guesses) {
    if (!guess || typeof guess.cityId !== "string" || !cityById.has(guess.cityId) || guessIds.has(guess.cityId) || typeof guess.correct !== "boolean" || guess.correct !== (guess.cityId === puzzleCity.id)) return false;
    guessIds.add(guess.cityId);
  }
  if (new Set(saved.arrowIds).size !== saved.arrowIds.length || !saved.arrowIds.every((id) => typeof id === "string" && cityById.has(id) && id !== puzzleCity.id)) return false;
  if (new Set(saved.hints.distanceGuessIds).size !== saved.hints.distanceGuessIds.length || !saved.hints.distanceGuessIds.every((id) => guessIds.has(id))) return false;
  if (saved.guesses.some((guess) => guess.correct) !== (saved.status === "won")) return false;
  if (saved.status === "playing" && saved.guesses.length >= MAX_GUESSES) return false;
  if (saved.status === "lost" && saved.guesses.length !== MAX_GUESSES) return false;
  return true;
}

function removeSavedState(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

function getStateStorageKey(dateKey, mode) {
  return mode === "practice" ? PRACTICE_STATE_KEY : STATE_PREFIX + dateKey;
}

function loadState(dateKey, puzzleCity, mode = "daily") {
  const storageKey = getStateStorageKey(dateKey, mode);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (isValidState(saved, dateKey, puzzleCity, mode)) return saved;
    if (saved !== null) removeSavedState(storageKey);
  } catch {
    removeSavedState(storageKey);
  }
  return makeInitialState(dateKey, puzzleCity);
}

function loadPracticeState() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRACTICE_STATE_KEY));
    const savedTarget = saved && cityById.get(saved.targetId);
    if (savedTarget && /^\d{4}-\d{2}-\d{2}$/.test(saved.dateKey) && isValidState(saved, saved.dateKey, savedTarget, "practice")) return saved;
    if (saved !== null) removeSavedState(PRACTICE_STATE_KEY);
  } catch {
    removeSavedState(PRACTICE_STATE_KEY);
  }
  return null;
}

function saveState() {
  try {
    localStorage.setItem(getStateStorageKey(state.dateKey, state.mode || "daily"), JSON.stringify(state));
  } catch {
    setFormMessage("Progress could not be saved in this browser.", true);
  }
}

function setFormMessage(message, isError = false) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle("is-error", isError);
}

function renderClues() {
  document.querySelectorAll(".clue-slot").forEach((slot) => { slot.replaceChildren(); });
  for (const cityId of state.arrowIds) {
    const city = cityById.get(cityId);
    if (!city) continue;
    const direction = getDirection(getBearing(target, city));
    const slot = document.querySelector(`.clue-slot[data-direction="${direction}"]`);
    const clue = document.createElement("span");
    clue.className = "clue-chip";
    const arrow = document.createElement("span");
    arrow.className = "clue-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = DIRECTION_ARROWS[direction];
    const name = document.createElement("span");
    name.textContent = city.name;
    clue.append(arrow, name);
    clue.title = `${city.name} is ${direction} of the mystery city`;
    slot.append(clue);
  }
}

function renderGuesses() {
  elements.guessList.replaceChildren();
  if (state.guesses.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-route";
    empty.textContent = "Your guesses will appear here.";
    elements.guessList.append(empty);
    return;
  }
  for (const guess of state.guesses) {
    const city = cityById.get(guess.cityId);
    const row = document.createElement("li");
    row.className = `guess-row ${guess.correct ? "is-correct" : "is-incorrect"}`;
    const name = document.createElement("strong");
    name.textContent = city.name;
    const status = document.createElement("span");
    status.className = "guess-status";
    status.textContent = guess.correct ? "Correct" : "Incorrect";
    row.append(name, status);
    elements.guessList.append(row);
  }
}

function renderResult() {
  const finished = state.status !== "playing";
  elements.resultPanel.hidden = !finished;
  elements.form.hidden = finished;
  if (!finished) return;
  elements.hintMessage.textContent = "";
  elements.resultKicker.textContent = state.status === "won" ? "CITY FOUND" : "PUZZLE COMPLETE";
  elements.resultTitle.textContent = state.status === "won" ? `You found ${target.name}.` : `Today's city was ${target.name}.`;
  elements.resultDetail.textContent = `${state.guesses.length} of ${MAX_GUESSES} guesses used · final score ${state.score.toLocaleString()}`;
  elements.usernameForm.hidden = hasSavedResult();
  if (hasSavedResult()) elements.saveMessage.textContent = "Result saved on this device.";
}

function render() {
  const practiceMode = state.mode === "practice";
  const remaining = MAX_GUESSES - state.guesses.length;
  elements.date.textContent = `${practiceMode ? "PRACTICE SCENARIO" : "DAILY CITY PUZZLE"} / ${state.dateKey}`;
  elements.practiceBanner.hidden = !practiceMode;
  elements.practiceButton.textContent = practiceMode ? "Next random city" : "Practice a random city";
  elements.board.closest(".play-panel").setAttribute("aria-label", practiceMode ? "Random practice scenario" : "Daily city puzzle");
  elements.score.textContent = state.score.toLocaleString();
  elements.guessesLeft.textContent = String(remaining);
  elements.attemptCount.textContent = `${state.guesses.length} / ${MAX_GUESSES}`;
  elements.hintButtons.forEach((button) => {
    const hint = button.dataset.hint;
    const arrowHint = hint === "arrow" || hint === "continentArrow";
    const noArrowAvailable = arrowHint && !getNextArrowCity(hint === "continentArrow");
    const noDistanceAvailable = hint === "distance" && !state.guesses.some((guess) => !state.hints.distanceGuessIds.includes(guess.cityId));
    button.disabled = state.status !== "playing" || noArrowAvailable || noDistanceAvailable || state.score < SCORE_COSTS[hint];
  });
  renderClues();
  renderGuesses();
  renderResult();
}

function findCity(input) {
  return cityByName.get(normalizeName(input));
}

function getNextArrowCity(sameContinent = false) {
  const candidates = cities.filter((city) => city.id !== target.id && !state.arrowIds.includes(city.id) && (!sameContinent || city.continent === target.continent));
  const directionCounts = new Map(DIRECTIONS.map((direction) => [direction, 0]));
  for (const cityId of state.arrowIds) {
    const city = cityById.get(cityId);
    if (city) directionCounts.set(getDirection(getBearing(target, city)), directionCounts.get(getDirection(getBearing(target, city))) + 1);
  }
  candidates.sort((left, right) => {
    const leftDirection = getDirection(getBearing(target, left));
    const rightDirection = getDirection(getBearing(target, right));
    return directionCounts.get(leftDirection) - directionCounts.get(rightDirection) || getDistanceKm(target, left) - getDistanceKm(target, right);
  });
  return candidates[0] || null;
}

function handleGuess(event) {
  event.preventDefault();
  if (state.status !== "playing") return;
  const city = findCity(elements.input.value);
  if (!city) {
    setFormMessage("That city is not in today's atlas. Try another name.", true);
    return;
  }
  if (state.guesses.some((guess) => guess.cityId === city.id)) {
    setFormMessage("You've already tried that city.", true);
    return;
  }
  const correct = city.id === target.id;
  state.guesses.push({ cityId: city.id, correct });
  if (correct) state.status = "won";
  else {
    state.score = Math.max(0, state.score - SCORE_COSTS.incorrectGuess);
    if (state.guesses.length === MAX_GUESSES) state.status = "lost";
  }
  elements.input.value = "";
  elements.hintMessage.textContent = "";
  setFormMessage(correct ? "Exactly right. City found!" : "Not this time. Read the bearings and keep going.");
  saveState();
  render();
}

function handleHint(event) {
  const button = event.currentTarget;
  const hint = button.dataset.hint;
  if (button.disabled || state.status !== "playing") return;
  if (hint === "arrow" || hint === "continentArrow") {
    const nextCity = getNextArrowCity(hint === "continentArrow");
    if (!nextCity) return;
    state.arrowIds.push(nextCity.id);
    elements.hintMessage.textContent = hint === "continentArrow"
      ? `New clue: ${nextCity.name} is in ${target.continent}.`
      : `Another bearing toward ${nextCity.name} is on your compass.`;
  } else {
    const latestGuess = [...state.guesses].reverse().find((guess) => !state.hints.distanceGuessIds.includes(guess.cityId));
    if (!latestGuess) {
      return;
    }
    state.hints.distanceGuessIds.push(latestGuess.cityId);
    const guessedCity = cityById.get(latestGuess.cityId);
    const distance = Math.round(getDistanceKm(guessedCity, target)).toLocaleString();
    elements.hintMessage.textContent = `${distance} km from ${guessedCity.name} to the mystery city.`;
  }
  state.score = Math.max(0, state.score - SCORE_COSTS[hint]);
  saveState();
  render();
}

function readResults() {
  try {
    const results = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

function hasSavedResult() {
  return readResults().some((result) => result.roundId === state.roundId || (!result.roundId && result.dateKey === state.dateKey && (result.mode || "daily") === (state.mode || "daily")));
}

function saveResult(event) {
  event.preventDefault();
  const results = readResults().filter((result) => result.roundId !== state.roundId);
  results.push({
    dateKey: state.dateKey,
    mode: state.mode || "daily",
    roundId: state.roundId,
    username: elements.username.value.trim().slice(0, 24),
    targetId: target.id,
    score: state.score,
    status: state.status,
    guesses: state.guesses.length,
  });
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
    elements.usernameForm.hidden = true;
    elements.saveMessage.textContent = "Result saved on this device.";
  } catch {
    elements.saveMessage.textContent = "This browser could not save the result.";
  }
}

function startPractice() {
  const previousPractice = loadPracticeState();
  target = getRandomTarget(cities, [target && target.id, previousPractice && previousPractice.targetId].filter(Boolean));
  state = makeInitialState(getPuzzleDate(), target, "practice");
  elements.hintMessage.textContent = "";
  elements.input.value = "";
  setFormMessage("New practice city selected. Follow the bearings.");
  saveState();
  render();
  elements.input.focus();
  document.querySelector(".play-panel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function returnToDaily() {
  const dateKey = getPuzzleDate();
  target = getDailyTarget(cities, dateKey);
  state = loadState(dateKey, target);
  if (!state.roundId) {
    state.roundId = createRoundId();
    saveState();
  }
  elements.hintMessage.textContent = "";
  elements.input.value = "";
  render();
  document.querySelector(".play-panel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function populateSuggestions() {
  elements.suggestions.replaceChildren();
  for (const city of cities) {
    const option = document.createElement("option");
    option.value = city.name;
    elements.suggestions.append(option);
  }
}

async function startGame() {
  try {
    const response = await fetch("./data/cities.json");
    if (!response.ok) throw new Error(`City data request failed (${response.status}).`);
    const payload = await response.json();
    cities = validateCityData(payload);
    cityById = new Map(cities.map((city) => [city.id, city]));
    cityByName = new Map();
    for (const city of cities) {
      for (const name of [city.name, ...(city.aliases || [])]) cityByName.set(normalizeName(name), city);
    }
    const dateKey = getPuzzleDate();
    const practiceState = loadPracticeState();
    if (practiceState) {
      state = practiceState;
      target = cityById.get(state.targetId);
    } else {
      target = getDailyTarget(cities, dateKey);
      state = loadState(dateKey, target);
    }
    if (!state.roundId) {
      state.roundId = createRoundId();
      saveState();
    }
    populateSuggestions();
    render();
  } catch (error) {
    document.querySelector("#game-title").textContent = "The atlas didn't load.";
    elements.form.hidden = true;
    elements.formMessage.textContent = `${error.message} Run this page from a local HTTP server and check the city data file.`;
    elements.formMessage.classList.add("is-error");
  }
}

elements.form.addEventListener("submit", handleGuess);
elements.hintButtons.forEach((button) => button.addEventListener("click", handleHint));
elements.usernameForm.addEventListener("submit", saveResult);
elements.practiceButton.addEventListener("click", startPractice);
elements.dailyModeButton.addEventListener("click", returnToDaily);
startGame();