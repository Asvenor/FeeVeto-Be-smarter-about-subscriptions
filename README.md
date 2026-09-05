# SubKiller

SubKiller is a private, no-signup subscription cost and renewal tracker. It helps people see recurring costs, upcoming renewals, and subscriptions that may be worth reviewing. Subscription data stays in the browser.

## Features

- Weekly, monthly, and yearly billing cycles
- Monthly and yearly cost totals
- Upcoming renewal tracking
- Explainable recommendations based on usage, importance, and cost
- Search, category filters, status filters, and sorting
- Add, edit, delete, cancel, and trial states
- JSON backup export and import
- Device-local, versioned storage with migration from the original format
- Responsive and keyboard-friendly interface

## Run locally

Serve the repository with any static file server. ES modules do not work reliably when `index.html` is opened directly as a file.

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Test

The automated suite uses Node's built-in test runner and does not require installing dependencies.

```sh
npm test
```

## Architecture

- `index.html` contains the accessible application structure.
- `style.css` contains the responsive visual system.
- `script.js` coordinates browser interactions and rendering.
- `src/core.js` contains pure calculations, validation, recommendations, filtering, and date logic.
- `src/storage.js` owns persistence, migration, recovery, and backup parsing.
- `tests/` covers the domain model, storage migration, and the static page contract.

The site is deployed to GitHub Pages after its tests pass on `main`.

## Privacy

The application stores subscription data in browser local storage and has no backend, account system, advertising, or product analytics. See the public [privacy overview](./privacy.html) for hosting and external-link details.

## License

No license has been selected yet. Until one is added, normal copyright rules apply.
