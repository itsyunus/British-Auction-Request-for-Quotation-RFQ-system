import { AuctionStatus, formatTriggerType } from "../domain/auction-engine.js";
import {
  escapeHtml,
  formatCompactDateTime,
  formatCurrency,
  formatDate,
  formatDateInputValue,
  formatDateTime,
  formatDateTimeLocalInput,
  pluralize,
} from "../utils/format.js";

function renderFlash(flash) {
  if (flash?.error) {
    return `<div class="flash flash--error">${escapeHtml(flash.error)}</div>`;
  }

  if (flash?.notice) {
    return `<div class="flash flash--notice">${escapeHtml(flash.notice)}</div>`;
  }

  return "";
}

function renderStatusPill(status) {
  const normalized = status.toLowerCase().replace(/\s+/g, "-");
  return `<span class="pill pill--${normalized}">${escapeHtml(status)}</span>`;
}

function renderTriggerBadges(triggerTypes) {
  return triggerTypes
    .map(
      (triggerType) =>
        `<span class="tag">${escapeHtml(formatTriggerType(triggerType))}</span>`,
    )
    .join("");
}

function renderMetricCard(label, value, accent) {
  return `
    <article class="metric-card">
      <span class="metric-card__label">${escapeHtml(label)}</span>
      <strong class="metric-card__value">${escapeHtml(value)}</strong>
      <span class="metric-card__accent">${escapeHtml(accent)}</span>
    </article>
  `;
}

function renderLayout({ title, activePath, flash, body }) {
  const navItems = [
    { href: "/", label: "Dashboard" },
    { href: "/rfqs/new", label: "New RFQ" },
    { href: "/docs/architecture", label: "Architecture" },
    { href: "/docs/schema", label: "Schema" },
    { href: "/docs/improvements", label: "Improvements" },
  ];

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)} | British Auction RFQ</title>
      <meta
        name="description"
        content="British Auction RFQ system assignment for GoComet, including listing, detail, configuration, and bid extension logic."
      />
      <link rel="stylesheet" href="/styles.css" />
      <script src="/client.js" defer></script>
    </head>
    <body>
      <div class="page-shell">
        <header class="topbar">
          <div class="topbar__brand">
            <span class="topbar__eyebrow">GoComet Recruitment Assignment</span>
            <a class="topbar__title" href="/">British Auction RFQ Control Tower</a>
          </div>
          <nav class="topbar__nav" aria-label="Primary navigation">
            ${navItems
              .map(
                (item) => `
                  <a class="topbar__link ${
                    activePath === item.href ? "topbar__link--active" : ""
                  }" href="${item.href}">
                    ${escapeHtml(item.label)}
                  </a>
                `,
              )
              .join("")}
          </nav>
        </header>
        <main class="page-content">
          ${renderFlash(flash)}
          ${body}
        </main>
        <footer class="footer">
          <div>Built as a runnable reference solution for the British Auction RFQ assignment.</div>
          <div>Node.js 24+, SQLite, server-rendered UI, and JSON APIs.</div>
        </footer>
      </div>
    </body>
  </html>`;
}

function renderDashboardTable(auctions) {
  const rows = auctions
    .map(
      (auction) => `
        <tr>
          <td>
            <a class="table-link" href="/auctions/${auction.id}">
              <strong>${escapeHtml(auction.referenceId)}</strong>
            </a>
            <div class="muted">${escapeHtml(auction.name)}</div>
          </td>
          <td>${auction.lowestBid ? formatCurrency(auction.lowestBid.totalAmount) : "Awaiting bids"}</td>
          <td>${formatDateTime(auction.currentBidCloseAt)}</td>
          <td>${formatDateTime(auction.forcedBidCloseAt)}</td>
          <td>${renderStatusPill(auction.status)}</td>
          <td>
            <div class="progress-pill">
              <span>${auction.scheduleProgress}% lifecycle</span>
              <div class="progress-pill__bar">
                <span style="width:${auction.scheduleProgress}%"></span>
              </div>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="panel">
      <div class="panel__header">
        <div>
          <span class="panel__eyebrow">Listing Page</span>
          <h2>British Auction catalog</h2>
        </div>
        <a class="button button--ghost" href="/api/auctions" target="_blank" rel="noreferrer">Open JSON API</a>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>RFQ</th>
              <th>Current Lowest Bid</th>
              <th>Current Close</th>
              <th>Forced Close</th>
              <th>Status</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderDashboardPage({ auctions, metrics, flash }) {
  return renderLayout({
    title: "Dashboard",
    activePath: "/",
    flash,
    body: `
      <section class="hero">
        <div class="hero__copy">
          <span class="section-kicker">Recruitment submission demo</span>
          <h1>Transparent reverse-auctioning for RFQs, with extension logic that holds up under edge cases.</h1>
          <p>
            This build covers the assignment end to end: RFQ creation, configurable British Auction rules,
            bid ranking, forced close caps, automatic extensions, activity logging, and a small JSON API for backend review.
          </p>
          <div class="hero__actions">
            <a class="button" href="/rfqs/new">Create RFQ</a>
            <a class="button button--ghost" href="/docs/architecture">Read HLD</a>
            <a class="button button--ghost" href="/docs/improvements">Future roadmap</a>
          </div>
        </div>
        <div class="hero__panel">
          <div class="hero__panel-grid">
            ${renderMetricCard("Active auctions", String(metrics.activeAuctions), "Live tracking")}
            ${renderMetricCard("Total auctions", String(metrics.totalAuctions), "Seeded + created")}
            ${renderMetricCard("Bids captured", String(metrics.totalBids), "Historical + latest")}
            ${renderMetricCard(
              "Suppliers competing",
              String(metrics.suppliersCompeting),
              "L1/L2/L3 standings",
            )}
          </div>
        </div>
      </section>

      <section class="dashboard-grid">
        ${renderDashboardTable(auctions)}
        <div class="stack">
          <article class="panel">
            <span class="panel__eyebrow">Assignment coverage</span>
            <h2>What is implemented</h2>
            <ul class="feature-list">
              <li>RFQ creation with British Auction configuration and validation rules.</li>
              <li>Bid submission with total-cost breakdown, ranking updates, and supplier-specific lowering rules.</li>
              <li>Extension triggers for bid received, any rank change, and L1 rank change.</li>
              <li>Forced-close cap enforcement, activity logs, and details page visibility.</li>
            </ul>
          </article>

          <article class="panel">
            <span class="panel__eyebrow">Reviewer shortcuts</span>
            <h2>Useful links</h2>
            <div class="api-links">
              <a href="/api/health" target="_blank" rel="noreferrer">GET /api/health</a>
              <a href="/api/auctions" target="_blank" rel="noreferrer">GET /api/auctions</a>
              <a href="/docs/architecture">View architecture notes</a>
              <a href="/docs/schema">View schema design</a>
              <a href="/docs/improvements">View future improvements</a>
            </div>
            <p class="muted">
              The seeded data includes one active auction, one scheduled auction, one closed auction,
              and one force-closed auction so the reviewer can inspect multiple states immediately.
            </p>
          </article>
        </div>
      </section>
    `,
  });
}

function renderTriggerChecklist(defaults) {
  const options = [
    {
      value: "BID_RECEIVED",
      title: "Bid received in last X minutes",
      description: "Extends whenever any supplier submits during the configured trigger window.",
    },
    {
      value: "ANY_RANK_CHANGE",
      title: "Any supplier rank change in last X minutes",
      description: "Extends when any supplier shifts position in the ranking order.",
    },
    {
      value: "LOWEST_BIDDER_CHANGE",
      title: "Lowest bidder (L1) rank change in last X minutes",
      description: "Extends only when leadership changes hands.",
    },
  ];

  return options
    .map(
      (option) => `
        <label class="check-card">
          <input
            type="checkbox"
            name="triggerTypes"
            value="${option.value}"
            ${defaults.triggerTypes.includes(option.value) ? "checked" : ""}
          />
          <span>
            <strong>${escapeHtml(option.title)}</strong>
            <small>${escapeHtml(option.description)}</small>
          </span>
        </label>
      `,
    )
    .join("");
}

export function renderCreateAuctionPage({ defaults, flash }) {
  return renderLayout({
    title: "Create RFQ",
    activePath: "/rfqs/new",
    flash,
    body: `
      <section class="subpage-hero">
        <div>
          <span class="section-kicker">RFQ Creation</span>
          <h1>Create a new British Auction RFQ</h1>
          <p>
            The form mirrors the assignment brief: schedule, forced-close guardrail, and extension behavior.
            Submitted RFQs appear immediately on the listing page and are available over the JSON API.
          </p>
        </div>
        <aside class="context-card">
          <h2>Validation rules</h2>
          <ul class="feature-list">
            <li>Bid close must be later than bid start.</li>
            <li>Forced close must be later than bid close.</li>
            <li>At least one extension trigger is required.</li>
            <li>Auctions never extend past forced close.</li>
          </ul>
        </aside>
      </section>

      <section class="panel form-panel">
        <form class="form-grid" method="post" action="/rfqs">
          <div class="form-section">
            <span class="panel__eyebrow">Identity</span>
            <label>
              <span>RFQ Name</span>
              <input type="text" name="name" value="${escapeHtml(defaults.name)}" required />
            </label>
            <label>
              <span>Reference ID</span>
              <input type="text" name="referenceId" value="${escapeHtml(defaults.referenceId)}" required />
            </label>
          </div>

          <div class="form-section">
            <span class="panel__eyebrow">Schedule</span>
            <label>
              <span>Bid Start Date &amp; Time</span>
              <input
                type="datetime-local"
                name="bidStartAt"
                value="${formatDateTimeLocalInput(defaults.bidStartAt)}"
                required
              />
            </label>
            <label>
              <span>Bid Close Date &amp; Time</span>
              <input
                type="datetime-local"
                name="bidCloseAt"
                value="${formatDateTimeLocalInput(defaults.bidCloseAt)}"
                required
              />
            </label>
            <label>
              <span>Forced Bid Close Date &amp; Time</span>
              <input
                type="datetime-local"
                name="forcedBidCloseAt"
                value="${formatDateTimeLocalInput(defaults.forcedBidCloseAt)}"
                required
              />
            </label>
            <label>
              <span>Pickup / Service Date</span>
              <input type="date" name="serviceDate" value="${formatDateInputValue(defaults.serviceDate)}" required />
            </label>
          </div>

          <div class="form-section form-section--wide">
            <span class="panel__eyebrow">Auction extension policy</span>
            <div class="split-fields">
              <label>
                <span>Trigger Window (X minutes)</span>
                <input
                  type="number"
                  min="1"
                  name="triggerWindowMinutes"
                  value="${escapeHtml(defaults.triggerWindowMinutes)}"
                  required
                />
              </label>
              <label>
                <span>Extension Duration (Y minutes)</span>
                <input
                  type="number"
                  min="1"
                  name="extensionDurationMinutes"
                  value="${escapeHtml(defaults.extensionDurationMinutes)}"
                  required
                />
              </label>
            </div>
            <div class="check-grid">
              ${renderTriggerChecklist(defaults)}
            </div>
          </div>

          <div class="form-actions">
            <button class="button" type="submit">Create RFQ</button>
            <a class="button button--ghost" href="/">Back to dashboard</a>
          </div>
        </form>
      </section>
    `,
  });
}

function renderAuctionSummary(auction) {
  const target =
    auction.status === AuctionStatus.SCHEDULED
      ? auction.bidStartAt
      : auction.status === AuctionStatus.ACTIVE
        ? auction.currentBidCloseAt
        : auction.forcedBidCloseAt;
  const label =
    auction.status === AuctionStatus.SCHEDULED
      ? "Starts in"
      : auction.status === AuctionStatus.ACTIVE
        ? "Current close in"
        : "Forced close";

  return `
    <section class="subpage-hero">
      <div>
        <a class="back-link" href="/">&larr; Back to dashboard</a>
        <span class="section-kicker">${escapeHtml(auction.referenceId)}</span>
        <h1>${escapeHtml(auction.name)}</h1>
        <p>
          British Auction RFQ with ${pluralize(auction.activeSupplierCount, "active supplier")} and
          ${pluralize(auction.totalBids, "submitted bid")}.
        </p>
      </div>
      <aside class="countdown-card">
        ${renderStatusPill(auction.status)}
        <strong class="countdown-card__value" data-countdown-target="${escapeHtml(target)}" data-expired-label="Closed">
          ${escapeHtml(label)}
        </strong>
        <span class="muted">${escapeHtml(label)} at ${formatDateTime(target)}</span>
      </aside>
    </section>
  `;
}

function renderBidSubmissionCard(auction, suppliers) {
  if (auction.status !== AuctionStatus.ACTIVE) {
    return `
      <article class="panel">
        <span class="panel__eyebrow">Quote Submission</span>
        <h2>Bidding unavailable</h2>
        <p class="muted">
          The auction is currently <strong>${escapeHtml(auction.status)}</strong>. Submit bids only while it is active.
        </p>
      </article>
    `;
  }

  return `
    <article class="panel quote-panel">
      <div class="panel__header">
        <div>
          <span class="panel__eyebrow">Quote Submission</span>
          <h2>Submit supplier bid</h2>
        </div>
        <div class="muted quote-panel__meta">
          Totals are auto-calculated from freight, origin, and destination charges.
        </div>
      </div>
      <form
        class="form-grid form-grid--tight quote-form"
        method="post"
        action="/auctions/${auction.id}/bids"
        data-bid-form
      >
        <div class="split-fields">
          <label>
            <span>Supplier</span>
            <select name="supplierId" required data-supplier-select>
              <option value="">Choose supplier</option>
              ${suppliers
                .map(
                  (supplier) => `
                    <option value="${supplier.id}" data-supplier-name="${escapeHtml(supplier.name)}">
                      ${escapeHtml(supplier.name)}
                    </option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label>
            <span>Carrier Name</span>
            <input type="text" name="carrierName" id="carrierName" placeholder="Carrier / legal entity name" required />
          </label>
        </div>

        <div class="split-fields split-fields--triple">
          <label>
            <span>Freight Charges</span>
            <input type="number" step="0.01" min="0" name="freightCharges" value="0" required data-total-input />
          </label>
          <label>
            <span>Origin Charges</span>
            <input type="number" step="0.01" min="0" name="originCharges" value="0" required data-total-input />
          </label>
          <label>
            <span>Destination Charges</span>
            <input type="number" step="0.01" min="0" name="destinationCharges" value="0" required data-total-input />
          </label>
        </div>

        <div class="split-fields">
          <label>
            <span>Transit Time (days)</span>
            <input type="number" min="1" name="transitTimeDays" value="3" required />
          </label>
          <label>
            <span>Validity of Quote</span>
            <input type="date" name="quoteValidUntil" value="${formatDateInputValue(auction.serviceDate)}" required />
          </label>
        </div>

        <div class="total-banner">
          <span>Current quote total</span>
          <strong data-total-preview>INR 0</strong>
        </div>

        <div class="form-actions">
          <button class="button" type="submit">Submit Bid</button>
        </div>
      </form>
    </article>
  `;
}

function renderStandingsTable(auction) {
  if (auction.standings.length === 0) {
    return `
      <article class="panel">
        <span class="panel__eyebrow">Supplier ranking</span>
        <h2>No bids yet</h2>
        <p class="muted">Once suppliers submit quotes, the live L1/L2/L3 standing appears here.</p>
      </article>
    `;
  }

  return `
    <article class="panel">
      <div class="panel__header">
        <div>
          <span class="panel__eyebrow">Supplier ranking</span>
          <h2>Live standings</h2>
        </div>
        <div class="muted">Latest bid per supplier, ranked lowest total first.</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Supplier</th>
              <th>Total</th>
              <th>Transit</th>
              <th>Validity</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            ${auction.standings
              .map(
                (bid) => `
                  <tr>
                    <td><span class="rank-badge">L${bid.rank}</span></td>
                    <td>
                      <strong>${escapeHtml(bid.supplierName)}</strong>
                      <div class="muted">${escapeHtml(bid.carrierName)}</div>
                    </td>
                    <td>${formatCurrency(bid.totalAmount)}</td>
                    <td>${escapeHtml(String(bid.transitTimeDays))} days</td>
                    <td>${formatDate(bid.quoteValidUntil)}</td>
                    <td>${formatCompactDateTime(bid.createdAt)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderAllBidsTable(auction) {
  return `
    <article class="panel">
      <div class="panel__header">
        <div>
          <span class="panel__eyebrow">All supplier bids</span>
          <h2>Bid history sorted by price</h2>
        </div>
        <div class="muted">Each row shows the submitted quote breakdown requested in the brief.</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Total</th>
              <th>Freight</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Transit</th>
              <th>Validity</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            ${
              auction.allBidsSorted.length === 0
                ? `
                  <tr>
                    <td colspan="8" class="empty-cell">No bids submitted yet.</td>
                  </tr>
                `
                : auction.allBidsSorted
                    .map(
                      (bid) => `
                        <tr>
                          <td>
                            <strong>${escapeHtml(bid.supplierName)}</strong>
                            <div class="muted">${escapeHtml(bid.carrierName)}</div>
                          </td>
                          <td>${formatCurrency(bid.totalAmount)}</td>
                          <td>${formatCurrency(bid.freightCharges)}</td>
                          <td>${formatCurrency(bid.originCharges)}</td>
                          <td>${formatCurrency(bid.destinationCharges)}</td>
                          <td>${escapeHtml(String(bid.transitTimeDays))} days</td>
                          <td>${formatDate(bid.quoteValidUntil)}</td>
                          <td>${formatCompactDateTime(bid.createdAt)}</td>
                        </tr>
                      `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderConfigurationPanel(auction) {
  return `
    <article class="panel">
      <span class="panel__eyebrow">Configuration</span>
      <h2>Auction controls</h2>
      <div class="detail-list">
        <div>
          <span>Bid start</span>
          <strong>${formatDateTime(auction.bidStartAt)}</strong>
        </div>
        <div>
          <span>Initial close</span>
          <strong>${formatDateTime(auction.initialBidCloseAt)}</strong>
        </div>
        <div>
          <span>Current close</span>
          <strong>${formatDateTime(auction.currentBidCloseAt)}</strong>
        </div>
        <div>
          <span>Forced close</span>
          <strong>${formatDateTime(auction.forcedBidCloseAt)}</strong>
        </div>
        <div>
          <span>Service date</span>
          <strong>${formatDate(auction.serviceDate)}</strong>
        </div>
        <div>
          <span>Trigger window</span>
          <strong>${escapeHtml(String(auction.config.triggerWindowMinutes))} minutes</strong>
        </div>
        <div>
          <span>Extension duration</span>
          <strong>${escapeHtml(String(auction.config.extensionDurationMinutes))} minutes</strong>
        </div>
        <div>
          <span>Forced close cap</span>
          <strong>${auction.extensionCapReached ? "Reached" : "Available"}</strong>
        </div>
      </div>
      <div class="tag-row">${renderTriggerBadges(auction.triggerTypes)}</div>
    </article>
  `;
}

function renderActivityLog(auction) {
  return `
    <article class="panel">
      <div class="panel__header">
        <div>
          <span class="panel__eyebrow">Activity log</span>
          <h2>Bid submissions and extensions</h2>
        </div>
        <div class="muted">Newest event first.</div>
      </div>
      <div class="timeline">
        ${
          auction.activityLogs.length === 0
            ? `<div class="timeline__item"><p>No activity captured yet.</p></div>`
            : auction.activityLogs
                .map(
                  (entry) => `
                    <article class="timeline__item">
                      <span class="timeline__type">${escapeHtml(entry.eventType)}</span>
                      <p>${escapeHtml(entry.message)}</p>
                      <small>${formatDateTime(entry.createdAt)}</small>
                    </article>
                  `,
                )
                .join("")
        }
      </div>
    </article>
  `;
}

export function renderAuctionDetailPage({ auction, suppliers, flash }) {
  return renderLayout({
    title: auction.referenceId,
    activePath: "/",
    flash,
    body: `
      ${renderAuctionSummary(auction)}

      <section class="metric-strip">
        ${renderMetricCard("Current leader", auction.lowestBid?.supplierName ?? "No leader yet", "L1 standing")}
        ${renderMetricCard(
          "Lowest total",
          auction.lowestBid ? formatCurrency(auction.lowestBid.totalAmount) : "Awaiting bids",
          "Best landed cost",
        )}
        ${renderMetricCard("Current close", formatCompactDateTime(auction.currentBidCloseAt), "Live auction timer")}
        ${renderMetricCard("Forced close", formatCompactDateTime(auction.forcedBidCloseAt), "Hard stop")}
      </section>

      <section class="detail-grid">
        <div class="stack">
          ${renderConfigurationPanel(auction)}
          ${renderBidSubmissionCard(auction, suppliers)}
        </div>
        <div class="stack">
          ${renderStandingsTable(auction)}
          ${renderAllBidsTable(auction)}
          ${renderActivityLog(auction)}
        </div>
      </section>
    `,
  });
}

export function renderDocumentPage({ title, markdown }) {
  return renderLayout({
    title,
    activePath:
      title === "Architecture"
        ? "/docs/architecture"
        : title === "Schema Design"
          ? "/docs/schema"
          : "/docs/improvements",
    flash: null,
    body: `
      <section class="subpage-hero">
        <div>
          <span class="section-kicker">Supporting documentation</span>
          <h1>${escapeHtml(title)}</h1>
          <p>These notes are included as part of the assignment deliverables.</p>
        </div>
      </section>
      <section class="panel">
        <pre class="document-view">${escapeHtml(markdown)}</pre>
      </section>
    `,
  });
}

export function renderNotFoundPage({ error = "The page you requested could not be found." } = {}) {
  return renderLayout({
    title: "Not Found",
    activePath: "",
    flash: null,
    body: `
      <section class="subpage-hero">
        <div>
          <span class="section-kicker">Navigation error</span>
          <h1>${escapeHtml(error)}</h1>
          <p>Use the dashboard to continue exploring the assignment solution.</p>
          <div class="hero__actions">
            <a class="button" href="/">Back to dashboard</a>
          </div>
        </div>
      </section>
    `,
  });
}
