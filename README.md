# Research Daily

A static GitHub Pages site for public research updates. Visitors can browse entries; the repository owner controls edits through commits. The site has no login, database, or visitor-facing write interface. Automatic collection from this computer and ISAAC has not been configured.

The entries do not cover every research activity. A blank date does not mean no research took place.

## Files

- `index.html`: page structure
- `styles.css`: styling
- `script.js`: calendar and entry display
- `research-data.json`: four approved public entries
- `.nojekyll`: serves the static files directly through GitHub Pages

## Add an entry

Add only information approved for public release to `research-data.json`. It is a JSON array; each entry follows this format:

```json
[
  {
    "id": "2026-10-01-example",
    "date": "2026-10-01",
    "title": "Approved public title",
    "summary": "Approved public summary of the update.",
    "category": "Optional category",
    "status": "Optional status",
    "note": "Optional clarification about the date or verification status.",
    "sources": []
  }
]
```

`date` must be a real date in `YYYY-MM-DD` format; `title` and `summary` are required. Keep `id` unique and stable. `status`, `note`, `details`, and `category` are optional. The current `sources` arrays are empty. Entries appear in descending date order. The page uses the original date strings without timezone conversion. Text is rendered as plain text, not HTML.

To preview locally, run a static HTTP server in this directory, for example `python -m http.server 8000`, then open `http://localhost:8000/`. Opening the HTML file directly may prevent the browser from loading the JSON file.

The repository owner publishes changes by committing approved content. The GitHub Pages publishing source is the root of the `main` branch.

