// ============================================================
// MOW OR NO — Google Apps Script v3
// Checks weather + calendar, creates mow window events
// UV-aware: prefers early morning / late afternoon windows
// Adapts seasonally via sunrise/sunset times
// ============================================================

// --- CONFIGURATION ---
const CONFIG = {
  // OpenWeatherMap API key (free tier: https://openweathermap.org/api)
  WEATHER_API_KEY: 'YOUR_API_KEY_HERE',

  // Your location coordinates (4 decimal places is plenty)
  LAT: -37.8122,
  LON: 145.3018,

  // Calendar to create mow events in
  MOW_CALENDAR_ID: 'YOUR_MOW_CALENDAR_ID_HERE',

  // Calendar to check for conflicts (your primary calendar)
  CHECK_CALENDAR_ID: 'primary',

  // --- Weather gates ---
  MAX_TEMP_C: 25,
  MAX_RAIN_PROB: 30,
  MAX_WIND_KMH: 30,
  MIN_RAIN_FREE_HOURS: 6,

  // --- Scheduling preferences ---
  DAYS_AHEAD: 5,
  EARLIEST_HOUR: 8,
  LATEST_HOUR: 18,
  MOW_DURATION_MINS: 90,
  MIN_FREE_BLOCK_MINS: 120,
  BUFFER_MINS: 15,

  // --- UV avoidance ---
  UV_PEAK_HALF_WIDTH_HOURS: 2,  // Avoid solar noon ± this many hours
  PREFER_MORNING: true,          // When both morning and afternoon pass, prefer morning

  // --- Scoring (soft preferences) ---
  IDEAL_TEMP_LOW: 15,
  IDEAL_TEMP_HIGH: 22,
  IDEAL_HUMIDITY_MAX: 60,
};

// --- MAIN FUNCTION (set this as your daily trigger) ---
function checkMowWindows() {
  const today = new Date();

  clearFutureMowEvents_();

  for (let d = 0; d < CONFIG.DAYS_AHEAD; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);

    const forecast = getWeatherForecast_(date);
    if (!forecast || forecast.length === 0) continue;

    const sunTimes = getSunTimes_();
    if (!sunTimes) continue;

    const solarNoon = getSolarNoon_(sunTimes, date);
    const freeBlocks = getFreeBlocks_(date);

    // Collect ALL passing windows for this day
    const candidates = [];

    for (const block of freeBlocks) {
      const step = CONFIG.MOW_DURATION_MINS * 60000;
      let windowStart = new Date(block.start);

      while (windowStart.getTime() + step <= block.end.getTime()) {
        const windowEnd = new Date(windowStart.getTime() + step);

        const relevantForecasts = forecast.filter(f =>
          f.dt >= windowStart.getTime() / 1000 - 3600 &&
          f.dt <= windowEnd.getTime() / 1000
        );

        if (relevantForecasts.length > 0) {
          const assessment = assessWeather_(relevantForecasts, forecast);
          if (assessment.canMow) {
            const uvScore = scoreUvPreference_(windowStart, windowEnd, solarNoon);
            candidates.push({
              start: new Date(windowStart),
              end: new Date(windowEnd),
              assessment: assessment,
              uvScore: uvScore.score,
              uvLabel: uvScore.label
            });
          }
        }

        windowStart = new Date(windowStart.getTime() + 3600000);
      }
    }

    // Pick the best window: highest UV score, then highest weather score
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (b.uvScore !== a.uvScore) return b.uvScore - a.uvScore;
        return b.assessment.score - a.assessment.score;
      });

      const best = candidates[0];
      best.assessment.reasons.push(best.uvLabel);
      createMowEvent_({ start: best.start, end: best.end }, best.assessment);
    }
  }

  Logger.log('Mow or No check complete.');
}

// --- SUN & UV FUNCTIONS ---

function getSunTimes_() {
  // Uses OpenWeatherMap current weather endpoint (free tier) for sunrise/sunset
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${CONFIG.LAT}&lon=${CONFIG.LON}&appid=${CONFIG.WEATHER_API_KEY}&units=metric`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(response.getContentText());

    if (!data.sys || !data.sys.sunrise || !data.sys.sunset) {
      Logger.log('No sunrise/sunset data in weather response');
      return null;
    }

    return {
      sunrise: new Date(data.sys.sunrise * 1000),
      sunset: new Date(data.sys.sunset * 1000)
    };
  } catch (e) {
    Logger.log('Sun times fetch failed: ' + e.message);
    return null;
  }
}

function getSolarNoon_(sunTimes, date) {
  // Solar noon = midpoint of sunrise and sunset
  // Adjust to target date (API returns today's times, but shift is minimal day-to-day)
  const sunriseMs = sunTimes.sunrise.getHours() * 3600000 + sunTimes.sunrise.getMinutes() * 60000;
  const sunsetMs = sunTimes.sunset.getHours() * 3600000 + sunTimes.sunset.getMinutes() * 60000;
  const noonMs = (sunriseMs + sunsetMs) / 2;

  const solarNoon = new Date(date);
  solarNoon.setHours(0, 0, 0, 0);
  return new Date(solarNoon.getTime() + noonMs);
}

function scoreUvPreference_(windowStart, windowEnd, solarNoon) {
  const peakStart = new Date(solarNoon.getTime() - CONFIG.UV_PEAK_HALF_WIDTH_HOURS * 3600000);
  const peakEnd = new Date(solarNoon.getTime() + CONFIG.UV_PEAK_HALF_WIDTH_HOURS * 3600000);

  const windowMid = new Date((windowStart.getTime() + windowEnd.getTime()) / 2);

  // Window entirely before peak UV
  if (windowEnd <= peakStart) {
    // Score by how early — earlier is better (more margin before UV ramps up)
    const hoursBeforePeak = (peakStart - windowEnd) / 3600000;
    return {
      score: 100 + (CONFIG.PREFER_MORNING ? 10 : 0) + hoursBeforePeak,
      label: `☀️ Early window — finishes ${hoursBeforePeak.toFixed(1)}hrs before peak UV`
    };
  }

  // Window entirely after peak UV
  if (windowStart >= peakEnd) {
    const hoursAfterPeak = (windowStart - peakEnd) / 3600000;
    return {
      score: 100 + (CONFIG.PREFER_MORNING ? 0 : 10) + hoursAfterPeak,
      label: `🌅 Afternoon window — starts ${hoursAfterPeak.toFixed(1)}hrs after peak UV`
    };
  }

  // Window overlaps peak — how much?
  const overlapStart = Math.max(windowStart.getTime(), peakStart.getTime());
  const overlapEnd = Math.min(windowEnd.getTime(), peakEnd.getTime());
  const overlapMins = (overlapEnd - overlapStart) / 60000;
  const windowMins = CONFIG.MOW_DURATION_MINS;
  const overlapPct = Math.round((overlapMins / windowMins) * 100);

  if (overlapPct < 30) {
    // Minor overlap — still acceptable
    return {
      score: 50 - overlapPct,
      label: `⚠️ Minor UV overlap (${overlapPct}% of mow time in peak)`
    };
  }

  // Significant overlap with peak UV
  return {
    score: 10 - overlapPct,
    label: `🔴 Peak UV window (${overlapPct}% of mow time in peak)`
  };
}

// --- WEATHER FUNCTIONS ---

function getWeatherForecast_(date) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${CONFIG.LAT}&lon=${CONFIG.LON}&appid=${CONFIG.WEATHER_API_KEY}&units=metric`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(response.getContentText());

    if (data.cod !== '200') {
      Logger.log('Weather API error: ' + response.getContentText());
      return null;
    }

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return data.list.filter(entry => {
      const entryDate = new Date(entry.dt * 1000);
      return entryDate >= dayStart && entryDate <= dayEnd;
    });
  } catch (e) {
    Logger.log('Weather fetch failed: ' + e.message);
    return null;
  }
}

function assessWeather_(windowForecasts, allDayForecasts) {
  const result = {
    canMow: true,
    score: 0,
    maxScore: 4,
    reasons: [],
    details: {}
  };

  let maxTemp = -Infinity;
  let maxWind = -Infinity;
  let maxRainProb = 0;
  let maxHumidity = 0;
  let avgTemp = 0;

  for (const f of windowForecasts) {
    const temp = f.main.temp;
    const windKmh = (f.wind.speed || 0) * 3.6;
    const rainProb = (f.pop || 0) * 100;
    const humidity = f.main.humidity || 0;

    maxTemp = Math.max(maxTemp, temp);
    maxWind = Math.max(maxWind, windKmh);
    maxRainProb = Math.max(maxRainProb, rainProb);
    maxHumidity = Math.max(maxHumidity, humidity);
    avgTemp += temp;
  }
  avgTemp = avgTemp / windowForecasts.length;

  result.details = {
    maxTemp: Math.round(maxTemp * 10) / 10,
    maxWind: Math.round(maxWind),
    rainProb: Math.round(maxRainProb),
    humidity: Math.round(maxHumidity),
    avgTemp: Math.round(avgTemp * 10) / 10
  };

  // --- Hard gates ---
  if (maxTemp > CONFIG.MAX_TEMP_C) {
    result.canMow = false;
    result.reasons.push(`Too hot: ${result.details.maxTemp}°C (max ${CONFIG.MAX_TEMP_C}°C)`);
  }

  if (maxRainProb > CONFIG.MAX_RAIN_PROB) {
    result.canMow = false;
    result.reasons.push(`Rain risk: ${result.details.rainProb}% (max ${CONFIG.MAX_RAIN_PROB}%)`);
  }

  if (maxWind > CONFIG.MAX_WIND_KMH) {
    result.canMow = false;
    result.reasons.push(`Too windy: ${result.details.maxWind} km/h (max ${CONFIG.MAX_WIND_KMH} km/h)`);
  }

  const priorRain = allDayForecasts.some(f => {
    const fTime = f.dt;
    const windowStart = windowForecasts[0].dt;
    return fTime < windowStart && fTime >= (windowStart - CONFIG.MIN_RAIN_FREE_HOURS * 3600) &&
           f.rain && f.rain['3h'] > 0.5;
  });

  if (priorRain) {
    result.canMow = false;
    result.reasons.push('Recent rain — grass likely wet');
  }

  // --- Soft scoring ---
  if (avgTemp >= CONFIG.IDEAL_TEMP_LOW && avgTemp <= CONFIG.IDEAL_TEMP_HIGH) {
    result.score += 2;
    result.reasons.push(`Ideal temp: ${result.details.avgTemp}°C ★`);
  } else if (avgTemp <= CONFIG.MAX_TEMP_C) {
    result.score += 1;
    result.reasons.push(`Acceptable temp: ${result.details.avgTemp}°C`);
  }

  if (maxHumidity <= CONFIG.IDEAL_HUMIDITY_MAX) {
    result.score += 1;
    result.reasons.push('Low humidity — clean cut');
  }

  if (maxRainProb < 10) {
    result.score += 1;
    result.reasons.push('Very low rain risk');
  }

  return result;
}

// --- CALENDAR FUNCTIONS ---

function getFreeBlocks_(date) {
  const dayStart = new Date(date);
  dayStart.setHours(CONFIG.EARLIEST_HOUR, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(CONFIG.LATEST_HOUR, 0, 0, 0);

  const calendar = CalendarApp.getCalendarById(CONFIG.CHECK_CALENDAR_ID);
  if (!calendar) {
    Logger.log('Cannot access calendar: ' + CONFIG.CHECK_CALENDAR_ID);
    return [];
  }

  const events = calendar.getEvents(dayStart, dayEnd);

  const busy = events
    .filter(e => e.getMyStatus() !== CalendarApp.GuestStatus.NO)
    .map(e => ({
      start: new Date(e.getStartTime().getTime() - CONFIG.BUFFER_MINS * 60000),
      end: new Date(e.getEndTime().getTime() + CONFIG.BUFFER_MINS * 60000)
    }))
    .sort((a, b) => a.start - b.start);

  const freeBlocks = [];
  let cursor = dayStart;

  for (const b of busy) {
    if (b.start > cursor) {
      const gap = (b.start - cursor) / 60000;
      if (gap >= CONFIG.MIN_FREE_BLOCK_MINS) {
        freeBlocks.push({ start: new Date(cursor), end: new Date(b.start) });
      }
    }
    if (b.end > cursor) {
      cursor = b.end;
    }
  }

  if (dayEnd > cursor) {
    const gap = (dayEnd - cursor) / 60000;
    if (gap >= CONFIG.MIN_FREE_BLOCK_MINS) {
      freeBlocks.push({ start: new Date(cursor), end: new Date(dayEnd) });
    }
  }

  return freeBlocks;
}

// --- EVENT CREATION ---

function createMowEvent_(block, assessment) {
  const calendar = CalendarApp.getCalendarById(CONFIG.MOW_CALENDAR_ID);
  if (!calendar) {
    Logger.log('Cannot access mow calendar: ' + CONFIG.MOW_CALENDAR_ID);
    return;
  }

  const mowStart = block.start;
  const mowEnd = block.end;

  const confidence = assessment.score >= 3 ? '🟢 GREAT' :
                     assessment.score >= 2 ? '🟡 GOOD' : '🔵 OK';

  const d = assessment.details;
  const description = [
    `${confidence} conditions (${assessment.score}/${assessment.maxScore})`,
    '',
    `🌡️ Temp: ${d.avgTemp}°C (max ${d.maxTemp}°C)`,
    `🌧️ Rain chance: ${d.rainProb}%`,
    `💨 Wind: ${d.maxWind} km/h`,
    `💧 Humidity: ${d.humidity}%`,
    '',
    '— Assessment —',
    ...assessment.reasons,
    '',
    'Generated by Mow or No 🌿'
  ].join('\n');

  const title = `${confidence} Mow Window`;

  const event = calendar.createEvent(title, mowStart, mowEnd, {
    description: description
  });

  if (assessment.score >= 3) {
    event.setColor(CalendarApp.EventColor.GREEN);
  } else if (assessment.score >= 2) {
    event.setColor(CalendarApp.EventColor.YELLOW);
  } else {
    event.setColor(CalendarApp.EventColor.CYAN);
  }

  Logger.log(`Created mow event: ${title} at ${mowStart.toLocaleTimeString()} on ${mowStart.toLocaleDateString()}`);
}

// --- CLEANUP ---

function clearFutureMowEvents_() {
  const calendar = CalendarApp.getCalendarById(CONFIG.MOW_CALENDAR_ID);
  if (!calendar) return;

  const now = new Date();
  const futureEnd = new Date();
  futureEnd.setDate(futureEnd.getDate() + CONFIG.DAYS_AHEAD + 1);

  const events = calendar.getEvents(now, futureEnd);
  for (const event of events) {
    if (event.getDescription().includes('Generated by Mow or No')) {
      event.deleteEvent();
    }
  }
}

// --- SETUP HELPER ---
function setupDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'checkMowWindows') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger('checkMowWindows')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone('Australia/Melbourne')
    .create();

  Logger.log('Daily trigger created for 6am AEST/AEDT');
}

// --- MANUAL TEST ---
function testRun() {
  checkMowWindows();
  Logger.log('Test run complete — check your Mow or No calendar');
}

// --- DIAGNOSTICS ---
function diagnose() {
  const today = new Date();
  Logger.log('=== MOW OR NO DIAGNOSTICS v3 (UV-aware) ===');
  Logger.log('Now: ' + today);
  Logger.log('');

  // Sun times
  const sunTimes = getSunTimes_();
  if (!sunTimes) {
    Logger.log('❌ Could not fetch sunrise/sunset');
    return;
  }
  const solarNoon = getSolarNoon_(sunTimes, today);
  const peakStart = new Date(solarNoon.getTime() - CONFIG.UV_PEAK_HALF_WIDTH_HOURS * 3600000);
  const peakEnd = new Date(solarNoon.getTime() + CONFIG.UV_PEAK_HALF_WIDTH_HOURS * 3600000);

  Logger.log('☀️ Sun times (today, used as seasonal baseline):');
  Logger.log('  Sunrise: ' + sunTimes.sunrise.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }));
  Logger.log('  Sunset:  ' + sunTimes.sunset.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }));
  Logger.log('  Solar noon: ' + solarNoon.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }));
  Logger.log('  Peak UV zone: ' + peakStart.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) +
    ' → ' + peakEnd.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }));
  Logger.log('  Day length: ' + ((sunTimes.sunset - sunTimes.sunrise) / 3600000).toFixed(1) + ' hours');
  Logger.log('');

  for (let d = 0; d < CONFIG.DAYS_AHEAD; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
    Logger.log('--- ' + dateStr + ' ---');

    const forecast = getWeatherForecast_(date);
    if (!forecast || forecast.length === 0) {
      Logger.log('  ❌ No forecast data');
      Logger.log('');
      continue;
    }
    Logger.log('  Forecast entries: ' + forecast.length);
    forecast.forEach(f => {
      const time = new Date(f.dt * 1000).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      Logger.log('    ' + time + ' → ' + f.main.temp + '°C, rain: ' + (f.pop * 100) + '%, wind: ' + Math.round(f.wind.speed * 3.6) + ' km/h, humidity: ' + f.main.humidity + '%');
    });

    const freeBlocks = getFreeBlocks_(date);
    Logger.log('  Free blocks: ' + freeBlocks.length);
    if (freeBlocks.length === 0) {
      Logger.log('  ❌ No free blocks in ' + CONFIG.EARLIEST_HOUR + ':00–' + CONFIG.LATEST_HOUR + ':00');
      Logger.log('');
      continue;
    }
    freeBlocks.forEach(b => {
      const bStart = b.start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      const bEnd = b.end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      Logger.log('    ' + bStart + ' → ' + bEnd);
    });

    Logger.log('  Sliding window analysis (UV-scored):');
    const step = CONFIG.MOW_DURATION_MINS * 60000;
    const candidates = [];
    const dateSolarNoon = getSolarNoon_(sunTimes, date);

    for (const block of freeBlocks) {
      let windowStart = new Date(block.start);

      while (windowStart.getTime() + step <= block.end.getTime()) {
        const windowEnd = new Date(windowStart.getTime() + step);
        const wStartStr = windowStart.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
        const wEndStr = windowEnd.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

        const relevant = forecast.filter(f =>
          f.dt >= windowStart.getTime() / 1000 - 3600 &&
          f.dt <= windowEnd.getTime() / 1000
        );

        if (relevant.length === 0) {
          Logger.log('    ' + wStartStr + '–' + wEndStr + ': no forecast data');
        } else {
          const assessment = assessWeather_(relevant, forecast);
          const uvScore = scoreUvPreference_(windowStart, windowEnd, dateSolarNoon);
          const icon = assessment.canMow ? '✅' : '❌';

          Logger.log('    ' + icon + ' ' + wStartStr + '–' + wEndStr +
            ' | temp: ' + assessment.details.avgTemp + '°C' +
            ' | rain: ' + assessment.details.rainProb + '%' +
            ' | wind: ' + assessment.details.maxWind + ' km/h' +
            ' | weather: ' + assessment.score + '/' + assessment.maxScore +
            ' | UV: ' + Math.round(uvScore.score));

          if (!assessment.canMow) {
            assessment.reasons.filter(r => r.includes('Too') || r.includes('Rain') || r.includes('Recent'))
              .forEach(r => Logger.log('       → ' + r));
          } else {
            Logger.log('       → ' + uvScore.label);
            candidates.push({
              start: new Date(windowStart),
              end: new Date(windowEnd),
              assessment: assessment,
              uvScore: uvScore.score,
              uvLabel: uvScore.label,
              timeLabel: wStartStr + '–' + wEndStr
            });
          }
        }

        windowStart = new Date(windowStart.getTime() + 3600000);
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (b.uvScore !== a.uvScore) return b.uvScore - a.uvScore;
        return b.assessment.score - a.assessment.score;
      });
      Logger.log('  ★ BEST WINDOW: ' + candidates[0].timeLabel + ' (UV score: ' + Math.round(candidates[0].uvScore) + ', ' + candidates[0].uvLabel + ')');
    } else {
      Logger.log('  ❌ No mowable window found for this day');
    }
    Logger.log('');
  }

  const mowCal = CalendarApp.getCalendarById(CONFIG.MOW_CALENDAR_ID);
  Logger.log('Mow calendar: ' + (mowCal ? '✅ ' + mowCal.getName() : '❌ Cannot access ' + CONFIG.MOW_CALENDAR_ID));
  Logger.log('=== DONE ===');
}