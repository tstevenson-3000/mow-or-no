# Mow or No — Setup Guide

## How It Works

The script runs daily at 6am and looks 3 days ahead. For each day it:

1. **Fetches the weather forecast** from OpenWeatherMap (3-hour intervals)
2. **Scans your calendar** for free blocks of 2+ hours between 8am–6pm
3. **Runs the decision gates** — any fail = no mow:
   - Temperature ≤ 25°C
   - Rain probability < 30%
   - Wind < 30 km/h
   - No rain in prior 6 hours
4. **Scores the conditions** (0–4) on ideal temp, humidity, and rain risk
5. **Creates a colour-coded calendar event** in your "Mow or No" calendar:
   - 🟢 GREEN = great conditions (score 3–4)
   - 🟡 YELLOW = good conditions (score 2)
   - 🔵 CYAN = acceptable (score 0–1)

Each event includes a weather summary so you can glance and decide.

Events that no longer match (e.g. forecast changed) are cleared and recalculated each morning.

---

## Setup Steps

### 1. Get an OpenWeatherMap API Key

- Sign up at https://openweathermap.org/api
- The **free tier** gives you 1,000 calls/day (this script uses ~1-2 per run)
- Copy your API key

### 2. Create a "Mow or No" Calendar

- In Google Calendar, click **+** next to "Other calendars" → **Create new calendar**
- Name it **Mow or No** (or whatever you like)
- Go to its **Settings** → scroll to **Integrate calendar** → copy the **Calendar ID**
  (it'll look like `abc123xyz@group.calendar.google.com`)

### 3. Create the Apps Script Project

- Go to https://script.google.com
- Click **New project**
- Name it "Mow or No"
- Delete the default `myFunction` code
- Paste in the entire contents of `mow-or-no.gs`

### 4. Configure

Edit the `CONFIG` section at the top:

```javascript
WEATHER_API_KEY: 'paste-your-key-here',
MOW_CALENDAR_ID: 'paste-your-calendar-id-here',
```

Optional tweaks:
- `MOW_DURATION_MINS: 90` — adjust to match your lawn (60 for a small one, 120 if it's bigger)
- `EARLIEST_HOUR: 8` / `LATEST_HOUR: 18` — your mowing hours
- `MAX_TEMP_C: 25` — already set to your preference
- `DAYS_AHEAD: 3` — look further ahead if useful

### 5. Authorise

- Select `testRun` from the function dropdown (top toolbar)
- Click **Run**
- Google will ask you to authorise calendar access — approve it
- Check the **Execution log** at the bottom for output
- Check your "Mow or No" calendar for events

### 6. Set Up the Daily Trigger

- Select `setupDailyTrigger` from the function dropdown
- Click **Run**
- This creates a daily 6am trigger (Melbourne time)

### 7. Done

You'll now see mow windows appearing in your calendar. If the forecast changes, the next morning's run will clear stale events and recalculate.

---

## Tuning Tips

- **Too many mow events?** Raise `MIN_FREE_BLOCK_MINS` or tighten the weather gates
- **Never getting events?** Lower `MAX_RAIN_PROB` tolerance or check your calendar isn't fully booked
- **Want weekend-only mowing?** Add a day-of-week filter in `checkMowWindows()`:
  ```javascript
  const dayOfWeek = date.getDay();
  if (dayOfWeek !== 0 && dayOfWeek !== 6) continue; // Skip weekdays
  ```
- **Coordinates wrong?** Update `LAT` and `LON` to your suburb for more accurate forecasts. 
  Google Maps → right-click your house → coordinates are shown.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No events appearing | Run `testRun` and check the Execution log for errors |
| "Cannot access calendar" | Double-check the calendar ID in CONFIG |
| Weather API errors | Verify your API key; new keys take ~2hrs to activate |
| Events in wrong timezone | The script uses your Google account timezone by default |
