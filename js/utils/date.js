/* js/utils/date.js */

/**
 * Returns today's date in local YYYY-MM-DD format
 * @returns {string} YYYY-MM-DD
 */
export function today() {
  const d = new Date();
  return formatDateLocal(d);
}

/**
 * Formats a Date object into local YYYY-MM-DD format
 * @param {Date} dateObj 
 * @returns {string} YYYY-MM-DD
 */
export function formatDateLocal(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks if a YYYY-MM-DD date string is today
 * @param {string} dateStr 
 * @returns {boolean}
 */
export function isToday(dateStr) {
  return dateStr === today();
}

/**
 * Calculates absolute number of days between two YYYY-MM-DD date strings
 * @param {string} dateA 
 * @param {string} dateB 
 * @returns {number}
 */
export function daysBetween(dateA, dateB) {
  const dA = new Date(dateA + 'T00:00:00');
  const dB = new Date(dateB + 'T00:00:00');
  const diffTime = Math.abs(dB - dA);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Formats hours and minutes into human-readable HH:MM format (24-hour)
 * @param {number} hours 
 * @param {number} minutes 
 * @returns {string} e.g. "09:30"
 */
export function formatTime(hours, minutes) {
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Formats a 24-hour time string "HH:MM" or (hours, minutes) into 12-hour AM/PM format
 * @param {string|number} hoursOrTimeStr 
 * @param {number} [minutes] 
 * @returns {string} e.g. "7:00 AM", "7:15 PM"
 */
export function formatTime12(hoursOrTimeStr, minutes) {
  let h, m;
  if (typeof hoursOrTimeStr === 'string' && hoursOrTimeStr.includes(':')) {
    [h, m] = hoursOrTimeStr.split(':').map(Number);
  } else {
    h = Number(hoursOrTimeStr || 0);
    m = Number(minutes || 0);
  }
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayM = String(m).padStart(2, '0');
  return `${displayH}:${displayM} ${period}`;
}

/**
 * Returns time of day period (morning/afternoon/evening) for a given Date
 * @param {Date} [date] Optional Date object, defaults to now 
 * @returns {"morning" | "afternoon" | "evening"}
 */
export function getTimeOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) {
    return 'morning';
  } else if (hour >= 12 && hour < 17) {
    return 'afternoon';
  } else {
    return 'evening';
  }
}

/**
 * Converts a YYYY-MM-DD date string into a friendly readable format
 * @param {string} dateStr 
 * @returns {string} e.g. "Today", "Yesterday", "Saturday, Aug 22"
 */
export function toReadableDate(dateStr) {
  if (dateStr === today()) return 'Today';
  
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (dateStr === formatDateLocal(yesterdayDate)) return 'Yesterday';
  
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  if (dateStr === formatDateLocal(tomorrowDate)) return 'Tomorrow';

  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  });
}
