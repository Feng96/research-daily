"use strict";

const monthTitle = document.getElementById("month-title");
const calendarDays = document.getElementById("calendar-days");
const entriesTitle = document.getElementById("entries-title");
const entryCount = document.getElementById("entry-count");
const entryList = document.getElementById("entry-list");
const status = document.getElementById("status");
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
let year = now.getFullYear();
let month = now.getMonth();
let selectedDate = null;
let records = [];
let loadError = false;

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

function dateKey(day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

function renderCalendar() {
  monthTitle.textContent = `${months[month]} ${year}`;
  calendarDays.replaceChildren();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const marked = new Set(records.map(item => item.date));
  for (let i = 0; i < offset; i++) calendarDays.append(document.createElement("span"));
  for (let day = 1; day <= count; day++) {
    const key = dateKey(day);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day";
    if (key === today) button.classList.add("today");
    if (marked.has(key)) button.classList.add("has-entry");
    button.textContent = String(day);
    button.setAttribute("aria-label", `${formatDate(key)}${marked.has(key) ? ", has a public entry" : ""}`);
    button.setAttribute("aria-pressed", String(selectedDate === key));
    button.addEventListener("click", () => { selectedDate = key; render(); });
    calendarDays.append(button);
  }
}

function renderEntries() {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const visible = records.filter(item => selectedDate ? item.date === selectedDate : item.date.startsWith(prefix));
  entriesTitle.textContent = selectedDate ? formatDate(selectedDate) : `${months[month]} ${year}`;
  entryCount.textContent = `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`;
  entryList.replaceChildren();
  if (loadError) {
    status.hidden = false;
    status.textContent = "Unable to load public entries. Check that research-data.json is in the same directory and open the page through a website URL.";
    return;
  }
  if (!records.length) {
    status.hidden = false;
    status.textContent = "No public entries are available yet. Approved updates will appear here.";
    return;
  }
  if (!visible.length) {
    status.hidden = false;
    status.textContent = selectedDate ? "No public entry is available for this date. Select another date or view the full month." : "No public entries are available for this month. Try another month.";
    return;
  }
  status.hidden = true;
  for (const item of visible) {
    const card = document.createElement("article");
    card.className = "card";
    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatDate(item.date);
    const heading = document.createElement("h3");
    heading.textContent = item.title;
    if (item.category) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = item.category;
      heading.append(badge);
    }
    if (item.status) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = item.status;
      heading.append(badge);
    }
    const summary = document.createElement("p");
    summary.textContent = item.summary;
    card.append(date, heading, summary);
    if (item.details) {
      const details = document.createElement("p");
      details.className = "details";
      details.textContent = item.details;
      card.append(details);
    }
    if (item.note) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = item.note;
      card.append(note);
    }
    entryList.append(card);
  }
}

function render() { renderCalendar(); renderEntries(); }

function changeMonth(delta) {
  const target = new Date(year, month + delta, 1);
  year = target.getFullYear();
  month = target.getMonth();
  selectedDate = null;
  render();
}

document.getElementById("previous-month").addEventListener("click", () => changeMonth(-1));
document.getElementById("next-month").addEventListener("click", () => changeMonth(1));
document.getElementById("show-month").addEventListener("click", () => { selectedDate = null; render(); });

renderCalendar();
fetch("research-data.json")
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then(data => {
    if (!Array.isArray(data)) throw new Error("Expected an array");
    records = data.filter(item => item && validDate(item.date) && typeof item.title === "string" && typeof item.summary === "string")
      .sort((a, b) => b.date.localeCompare(a.date));
    if (records.length) {
      year = Number(records[0].date.slice(0, 4));
      month = Number(records[0].date.slice(5, 7)) - 1;
    }
    render();
  })
  .catch(() => { loadError = true; render(); });

