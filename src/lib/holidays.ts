export type CalendarHoliday = {
  date: string;
  name: string;
  observed: boolean;
};

function dateKey(date: Date) {
  return date.toISOString().split("T")[0];
}

function fixedHoliday(year: number, month: number, day: number, name: string) {
  const actual = new Date(year, month, day);
  const holidays: CalendarHoliday[] = [
    { date: dateKey(actual), name, observed: false },
  ];

  if (actual.getDay() === 0) {
    holidays.push({
      date: dateKey(new Date(year, month, day + 1)),
      name,
      observed: true,
    });
  }

  if (actual.getDay() === 6) {
    holidays.push({
      date: dateKey(new Date(year, month, day - 1)),
      name,
      observed: true,
    });
  }

  return holidays;
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const date = new Date(year, month, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return date;
}

function lastWeekday(year: number, month: number, weekday: number) {
  const date = new Date(year, month + 1, 0);
  const offset = (date.getDay() - weekday + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

export function getUsFederalHolidaysForYear(year: number): CalendarHoliday[] {
  return [
    ...fixedHoliday(year, 0, 1, "New Year's Day"),
    {
      date: dateKey(nthWeekday(year, 0, 1, 3)),
      name: "Birthday of Martin Luther King, Jr.",
      observed: false,
    },
    {
      date: dateKey(nthWeekday(year, 1, 1, 3)),
      name: "Washington's Birthday",
      observed: false,
    },
    {
      date: dateKey(lastWeekday(year, 4, 1)),
      name: "Memorial Day",
      observed: false,
    },
    ...fixedHoliday(year, 5, 19, "Juneteenth National Independence Day"),
    ...fixedHoliday(year, 6, 4, "Independence Day"),
    {
      date: dateKey(nthWeekday(year, 8, 1, 1)),
      name: "Labor Day",
      observed: false,
    },
    {
      date: dateKey(nthWeekday(year, 9, 1, 2)),
      name: "Columbus Day",
      observed: false,
    },
    ...fixedHoliday(year, 10, 11, "Veterans Day"),
    {
      date: dateKey(nthWeekday(year, 10, 4, 4)),
      name: "Thanksgiving Day",
      observed: false,
    },
    ...fixedHoliday(year, 11, 25, "Christmas Day"),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function getUsFederalHolidaysForDates(dateKeys: string[]) {
  const years = Array.from(
    new Set(dateKeys.map((key) => new Date(`${key}T00:00:00`).getFullYear()))
  );
  const holidays = years.flatMap(getUsFederalHolidaysForYear);
  const requested = new Set(dateKeys);

  return holidays.filter((holiday) => requested.has(holiday.date));
}
