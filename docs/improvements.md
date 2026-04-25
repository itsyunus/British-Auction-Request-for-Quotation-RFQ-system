# Future Improvements

## Product improvements

1. Add buyer and supplier authentication with role-based access.
2. Support live auction updates with WebSockets or Server-Sent Events.
3. Add buyer-side controls to pause, cancel, or manually close an auction.
4. Add supplier notifications for rank changes, near-close reminders, and forced-close warnings.
5. Show richer analytics such as bid velocity, participation rate, and savings versus baseline.
6. Support attachment uploads for supporting quotation documents.
7. Add filters, search, and pagination for larger auction catalogs.
8. Add multi-lane and multi-leg RFQ support for broader logistics use cases.

## Engineering improvements

1. Move from SQLite to PostgreSQL for multi-user production workloads.
2. Add migrations and environment-based configuration management.
3. Introduce authentication middleware and audit-grade access logging.
4. Add optimistic locking or row-version checks for high-concurrency bid submission.
5. Split the project into clearer controller, service, repository, and view modules.
6. Add integration tests for the HTTP routes and database transactions.
7. Add containerization and CI for linting, tests, and deployment readiness.
8. Add structured logs, metrics, and alerts for operational visibility.

## Domain-specific improvements

1. Support more auction types beyond British Auction.
2. Add configurable tie-break rules when two suppliers submit the same total.
3. Add bid floors, minimum decrement rules, or supplier eligibility rules.
4. Add time-zone aware scheduling for cross-region auctions.
5. Add event replay or snapshots for easier audit and debugging.
6. Persist derived ranking snapshots for historical reporting.

## UX improvements

1. Add inline validation and richer success/error states.
2. Highlight why an extension happened directly beside the countdown.
3. Add live diff indicators showing how far each supplier is from L1.
4. Add responsive table cards for smaller screens.
5. Improve accessibility with stronger focus states and ARIA enhancements.

## If this became a real GoComet feature

I would prioritize the roadmap in this order:

1. Authentication and role separation.
2. PostgreSQL plus migrations.
3. Real-time auction updates.
4. Concurrency safety and stronger audit trails.
5. Analytics and notification workflows.
