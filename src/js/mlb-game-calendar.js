/**
 * Stepped calendar popover: year → month → day (MLB browse date range).
 */

import {
  formatLocalDateString,
  getMlbBrowseYears,
  getMlbBrowseMinDateIso,
  getMlbBrowseMaxDateIso,
} from './mlb-api.js';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** @type {'year' | 'month' | 'day'} */
let pickerStep = 'day';
let viewYear;
let viewMonth;
let selectedIso = '';
let onSelectCallback = null;
let bound = false;

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLabel(iso) {
  if (!iso) return 'Pick date';
  const dt = parseIso(iso);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function clampViewToBounds() {
  const maxIso = getMlbBrowseMaxDateIso();
  const minIso = getMlbBrowseMinDateIso();
  const maxD = parseIso(maxIso);
  const minD = parseIso(minIso);
  if (viewYear > maxD.getFullYear()) viewYear = maxD.getFullYear();
  if (viewYear < minD.getFullYear()) viewYear = minD.getFullYear();
  const maxMonth = viewYear === maxD.getFullYear() ? maxD.getMonth() : 11;
  const minMonth = viewYear === minD.getFullYear() ? minD.getMonth() : 0;
  if (viewMonth > maxMonth) viewMonth = maxMonth;
  if (viewMonth < minMonth) viewMonth = minMonth;
}

function applySelection(iso) {
  selectedIso = iso;
  const label = document.getElementById('game-finder-date-label');
  if (label) label.textContent = formatLabel(iso);
  const hidden = document.getElementById('game-finder-date');
  if (hidden) hidden.value = iso;
}

function setStep(step) {
  pickerStep = step;
  clampViewToBounds();
  renderCalendar();
}

function getHeadEls() {
  return {
    grid: document.getElementById('game-finder-cal-grid'),
    title: document.getElementById('game-finder-cal-title'),
    weekdays: document.querySelector('.game-finder-calendar__weekdays'),
    prev: document.querySelector('[data-cal-prev]'),
    next: document.querySelector('[data-cal-next]'),
    pop: document.getElementById('game-finder-calendar-popover'),
  };
}

function updateHeadNav() {
  const { title, weekdays, prev, next, pop } = getHeadEls();
  if (!title || !pop) return;

  pop.dataset.calStep = pickerStep;

  if (pickerStep === 'year') {
    title.textContent = 'Select year';
    title.disabled = true;
    title.setAttribute('aria-label', 'Select year');
    if (weekdays) weekdays.classList.add('hidden');
    if (prev) prev.hidden = true;
    if (next) next.hidden = true;
    return;
  }

  title.disabled = false;

  if (pickerStep === 'month') {
    title.textContent = String(viewYear);
    title.setAttribute('aria-label', `${viewYear}, choose month`);
    if (weekdays) weekdays.classList.add('hidden');
    if (prev) {
      prev.hidden = false;
      prev.setAttribute('aria-label', 'Previous year');
    }
    if (next) {
      next.hidden = false;
      next.setAttribute('aria-label', 'Next year');
    }
    return;
  }

  const monthDate = new Date(viewYear, viewMonth, 1);
  title.textContent = monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  title.setAttribute('aria-label', `${title.textContent}, choose month`);
  if (weekdays) weekdays.classList.remove('hidden');
  if (prev) {
    prev.hidden = false;
    prev.setAttribute('aria-label', 'Previous month');
  }
  if (next) {
    next.hidden = false;
    next.setAttribute('aria-label', 'Next month');
  }
}

function renderYearStep(grid) {
  grid.className = 'game-finder-calendar__grid game-finder-calendar__grid--pick';
  grid.replaceChildren();
  const years = getMlbBrowseYears();
  const maxYear = new Date().getFullYear();
  const minYear = years[years.length - 1];

  years.forEach((year) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'game-finder-calendar__pick';
    btn.textContent = String(year);
    if (year === viewYear) btn.classList.add('game-finder-calendar__pick--selected');
    if (year === maxYear) btn.classList.add('game-finder-calendar__pick--current');
    if (year < minYear || year > maxYear) {
      btn.disabled = true;
      btn.classList.add('game-finder-calendar__pick--disabled');
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewYear = year;
      clampViewToBounds();
      setStep('month');
    });
    grid.appendChild(btn);
  });
}

function renderMonthStep(grid) {
  grid.className = 'game-finder-calendar__grid game-finder-calendar__grid--pick';
  grid.replaceChildren();

  const maxIso = getMlbBrowseMaxDateIso();
  const minIso = getMlbBrowseMinDateIso();
  const maxD = parseIso(maxIso);
  const minD = parseIso(minIso);

  const selectedDate = selectedIso ? parseIso(selectedIso) : null;

  MONTH_NAMES.forEach((name, monthIndex) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'game-finder-calendar__pick game-finder-calendar__pick--month';
    btn.textContent = name;

    const monthStart = formatLocalDateString(new Date(viewYear, monthIndex, 1));
    const monthEnd = formatLocalDateString(new Date(viewYear, monthIndex + 1, 0));
    const outOfRange = monthEnd < minIso || monthStart > maxIso;
    const isFuture =
      viewYear > maxD.getFullYear()
      || (viewYear === maxD.getFullYear() && monthIndex > maxD.getMonth());

    if (
      selectedDate
      && selectedDate.getFullYear() === viewYear
      && selectedDate.getMonth() === monthIndex
    ) {
      btn.classList.add('game-finder-calendar__pick--selected');
    }
    if (outOfRange || isFuture) {
      btn.disabled = true;
      btn.classList.add('game-finder-calendar__pick--disabled');
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth = monthIndex;
      clampViewToBounds();
      setStep('day');
    });
    grid.appendChild(btn);
  });
}

function renderDayStep(grid) {
  grid.className = 'game-finder-calendar__grid game-finder-calendar__grid--days';
  grid.replaceChildren();

  const todayIso = getMlbBrowseMaxDateIso();
  const minIso = getMlbBrowseMinDateIso();
  const monthDate = new Date(viewYear, viewMonth, 1);
  const firstDow = monthDate.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDow; i++) {
    const pad = document.createElement('span');
    pad.className = 'game-finder-calendar__pad';
    pad.setAttribute('aria-hidden', 'true');
    grid.appendChild(pad);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(viewYear, viewMonth, day);
    const iso = formatLocalDateString(dt);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'game-finder-calendar__day';
    btn.textContent = String(day);
    if (iso === todayIso) btn.classList.add('game-finder-calendar__day--today');
    if (iso === selectedIso) btn.classList.add('game-finder-calendar__day--selected');
    if (iso > todayIso || iso < minIso) {
      btn.disabled = true;
      btn.classList.add('game-finder-calendar__day--disabled');
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      applySelection(iso);
      closeCalendarPopover();
      onSelectCallback?.(iso);
    });
    grid.appendChild(btn);
  }
}

function renderCalendar() {
  const { grid } = getHeadEls();
  if (!grid || viewYear == null || viewMonth == null) return;

  updateHeadNav();

  if (pickerStep === 'year') {
    renderYearStep(grid);
  } else if (pickerStep === 'month') {
    renderMonthStep(grid);
  } else {
    renderDayStep(grid);
  }

  const label = document.getElementById('game-finder-date-label');
  if (label && selectedIso) label.textContent = formatLabel(selectedIso);
}

function stepHeadPrev() {
  const minYear = getMlbBrowseYears().at(-1);
  const maxYear = new Date().getFullYear();
  if (pickerStep === 'month') {
    viewYear = Math.max(minYear, viewYear - 1);
    clampViewToBounds();
    renderCalendar();
    return;
  }
  if (pickerStep === 'day') {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    clampViewToBounds();
    renderCalendar();
  }
}

function stepHeadNext() {
  const maxYear = new Date().getFullYear();
  const maxIso = getMlbBrowseMaxDateIso();
  const maxD = parseIso(maxIso);

  if (pickerStep === 'month') {
    viewYear = Math.min(maxYear, viewYear + 1);
    clampViewToBounds();
    renderCalendar();
    return;
  }
  if (pickerStep === 'day') {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    if (viewYear > maxD.getFullYear()) {
      viewYear = maxD.getFullYear();
      viewMonth = maxD.getMonth();
    }
    clampViewToBounds();
    renderCalendar();
  }
}

export function closeCalendarPopover() {
  const pop = document.getElementById('game-finder-calendar-popover');
  const toggle = document.getElementById('btn-game-finder-calendar');
  pop?.classList.add('hidden');
  pop?.setAttribute('aria-hidden', 'true');
  toggle?.setAttribute('aria-expanded', 'false');
  pickerStep = 'day';
}

export function setGameFinderCalendarDate(date) {
  let d;
  if (date instanceof Date) {
    d = date;
  } else if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    d = parseIso(date);
  } else {
    d = new Date();
  }
  if (Number.isNaN(d.getTime())) {
    d = new Date();
  }
  selectedIso = formatLocalDateString(d);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  clampViewToBounds();
  const hidden = document.getElementById('game-finder-date');
  if (hidden) hidden.value = selectedIso;
  const label = document.getElementById('game-finder-date-label');
  if (label) label.textContent = formatLabel(selectedIso);
  const pop = document.getElementById('game-finder-calendar-popover');
  if (pop && !pop.classList.contains('hidden')) {
    renderCalendar();
  }
}

export function getGameFinderCalendarDate() {
  const hidden = document.getElementById('game-finder-date');
  return hidden?.value || selectedIso || formatLocalDateString();
}

export function initGameFinderCalendar({ onDateSelected } = {}) {
  onSelectCallback = onDateSelected;
  const toggle = document.getElementById('btn-game-finder-calendar');
  const pop = document.getElementById('game-finder-calendar-popover');
  const title = document.getElementById('game-finder-cal-title');
  if (!toggle || !pop) return;

  setGameFinderCalendarDate(new Date());

  if (!bound) {
    bound = true;
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.classList.contains('hidden');
      if (open) {
        if (selectedIso) {
          const d = parseIso(selectedIso);
          viewYear = d.getFullYear();
          viewMonth = d.getMonth();
        }
        pickerStep = 'day';
        clampViewToBounds();
        renderCalendar();
        pop.classList.remove('hidden');
        pop.setAttribute('aria-hidden', 'false');
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        closeCalendarPopover();
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    title?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (title.disabled) return;
      if (pickerStep === 'day') setStep('month');
      else if (pickerStep === 'month') setStep('year');
    });

    pop.querySelector('[data-cal-prev]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      stepHeadPrev();
    });

    pop.querySelector('[data-cal-next]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      stepHeadNext();
    });

    document.addEventListener('click', (e) => {
      if (pop.classList.contains('hidden')) return;
      if (e.target.closest('.mlb-date-picker')) return;
      closeCalendarPopover();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeCalendarPopover();
    });
  }
}
