# Mow or No 🌿

A Google Apps Script that automatically identifies the best time to mow your lawn by cross-referencing weather forecasts with your calendar availability, then drops a colour-coded event into Google Calendar.

## The Problem

Mowing is weather-dependent. You need dry grass, reasonable temperatures, manageable wind, and no rain on the horizon. You also need a free block in your diary long enough to actually do the job. Manually checking forecasts against your calendar every day is tedious, and you inevitably end up either mowing in poor conditions or missing good windows entirely.

On top of that, mowing in peak UV (typically solar noon ± 2 hours) is something worth avoiding — especially during Australian summers. The best windows are early morning or late afternoon, but exactly when those fall shifts as the seasons change.

## How It Works

The script runs daily at 6am via a Google Apps Script time-based trigger. For each of the next 5 days, it:

1. **Fetches the weather forecast** from OpenWeatherMap's free API in 3-hour intervals
2. **Fetches sunrise and sunset times** to calculate solar noon and the peak UV avoidance zone
3. **Scans your Google Calendar** for free blocks of 2+ hours between your configured mowing hours (default 8am–6pm)
4. **Slides a 90-minute mow window** across each free block in 1-hour steps
5. **Applies hard weather gates** — any failure disqualifies the window:
   - Temperature ≤ 25°C
   - Rain probability < 30%
   - Wind speed < 30 km/h
   - No rain in the prior 6 hours (wet grass)
6. **Scores passing windows** on soft preferences (0–4 points):
   - Ideal temperature range (15–22°C): +2
   - Low humidity (< 60%): +1
   - Very low rain risk (< 10%): +1
7. **Scores each window for UV preference** — windows furthest from peak UV score highest, with a configurable morning bias
8. **Picks the single best window per day** — highest UV score first, then highest weather score as tiebreaker
9. **Creates a colour-coded calendar event** in a dedicated "Mow or No" calendar:
   - 🟢 Pale green = GREAT conditions (score 3–4)
   - 🟡 Yellow = GOOD conditions (score 2)
   - 🔵 Cyan = OK conditions (score 0–1)

Each calendar event includes a weather summary and UV assessment in the description, so you can glance and decide.

Events are cleared and recalculated each morning, so if the forecast shifts overnight, your calendar updates automatically.

## Seasonal Adaptation

The UV avoidance zone is calculated from actual sunrise/sunset times, not fixed hours. This means:

- **Summer** (e.g. sunrise 6:10am, sunset 8:30pm): solar noon ~1:20pm, peak UV zone ~11:20am–3:20pm. The script favours early morning windows.
- **Winter** (e.g. sunrise 7:20am, sunset 5:20pm): solar noon ~12:20pm, peak UV zone ~10:20am–2:20pm. Mowing hours are shorter, and the script adjusts accordingly.

No manual seasonal configuration required.

## Architecture

The entire solution is a single Google Apps Script file — no external hosting, no server, no dependencies beyond the free OpenWeatherMap API. It runs inside Google's infrastructure on a daily trigger and writes directly to Google Calendar.

### API Calls Per Run

- 1× OpenWeatherMap `/forecast` endpoint (5-day/3-hour forecast)
- 1× OpenWeatherMap `/weather` endpoint (sunrise/sunset times)
- Google Calendar reads and writes via the built-in `CalendarApp` service

Both OpenWeatherMap calls are well within the free tier limit of 1,000 calls/day.

## Available Functions

| Function | Purpose |
|----------|---------|
| `checkMowWindows()` | Main function — runs the full assessment and creates events |
| `setupDailyTrigger()` | Creates a 6am daily trigger (Melbourne time) |
| `testRun()` | Runs `checkMowWindows()` manually for testing |
| `diagnose()` | Detailed diagnostic output — shows sun times, UV zones, every sliding window with scores, and the selected best window per day |

## Configuration

All settings are in the `CONFIG` object at the top of the script. Key values:

| Setting | Default | Description |
|---------|---------|-------------|
| `DAYS_AHEAD` | 5 | How many days to look ahead |
| `MAX_TEMP_C` | 25 | Hard gate: skip if temp exceeds this |
| `MAX_RAIN_PROB` | 30 | Hard gate: skip if rain % exceeds this |
| `MOW_DURATION_MINS` | 90 | How long you need to mow |
| `EARLIEST_HOUR` | 8 | Don't mow before this hour |
| `LATEST_HOUR` | 18 | Finish by this hour |
| `UV_PEAK_HALF_WIDTH_HOURS` | 2 | Avoid solar noon ± this many hours |
| `PREFER_MORNING` | true | When both morning and afternoon pass, prefer morning |

See `SETUP.md` for installation instructions.

## Credits

Designed and coded by [Claude](https://claude.ai) by [Anthropic](https://www.anthropic.com), through iterative conversation with a human collaborator. The project evolved from a simple weather-gate concept through diagnostic-driven debugging to the current UV-aware sliding window implementation.
