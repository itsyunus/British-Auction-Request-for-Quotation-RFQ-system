const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const compactDateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
});

const escapeMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => escapeMap[character]);
}

export function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Awaiting bids";
  }

  return currencyFormatter.format(Number(value));
}

export function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatCompactDateTime(value) {
  if (!value) {
    return "—";
  }

  return compactDateTimeFormatter.format(new Date(value));
}

export function formatDate(value) {
  if (!value) {
    return "—";
  }

  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);

  return dateFormatter.format(candidate);
}

export function formatDateTimeLocalInput(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];

  const timeParts = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ];

  return `${parts.join("-")}T${timeParts.join(":")}`;
}

export function formatDateInputValue(value) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return String(value);
  }

  const date = new Date(value);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];

  return parts.join("-");
}

export function shiftIsoByMinutes(baseIso, minutes) {
  return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString();
}

export function shiftDateByDays(baseIso, days) {
  const date = new Date(baseIso);
  date.setDate(date.getDate() + days);
  return formatDateInputValue(date.toISOString());
}

export function buildQueryString(entries) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : "";
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
