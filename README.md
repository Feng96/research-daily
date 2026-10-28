# Research Daily

A static GitHub Pages site for public research updates. Visitors can browse entries; the repository owner controls edits through commits. The site has no login, database, or visitor-facing write interface. Automatic collection from this computer and ISAAC has not been configured.

The entries do not cover every research activity. A blank date does not mean no research took place.

## Files

- `index.html`: page structure
- `styles.css`: styling
- `script.js`: calendar and entry display
- `research-data.json`: reviewed public entries
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

`date` must be a real date in `YYYY-MM-DD` format; `title` and `summary` are required. Keep `id` unique and stable. `status`, `note`, `details`, and `category` are optional. Each source is an object with `label` and an absolute HTTPS `url`; valid sources render as links below the entry. Sources can point to related experiments or background material and are not automatically independent validation. Entries appear in descending date order. The page uses the original date strings without timezone conversion. Text is rendered as plain text, not HTML.

To preview locally, run a static HTTP server in this directory, for example `python -m http.server 8000`, then open `http://localhost:8000/`. Opening the HTML file directly may prevent the browser from loading the JSON file.

The repository owner publishes changes by committing approved content. The GitHub Pages publishing source is the root of the `main` branch.


## October 22, 2026 history update

Added 14 dated entries from the USBF and LoD2 research histories, preserving all 15 existing entries. Dates use America/New_York. Production completion, release preparation, controlled experiments and real-observation diagnostics are explicitly separated. Public entries contain summaries and public links, not private transcripts or infrastructure credentials.

## October 28, 2026 update

Added 16 entries for October 23–28, preserving all 29 earlier records (45 total). The update covers six-state publication, SpaceNet reference-frame and circle checks, geometric-change analysis, the local and public reproducible workflow, LoD2 point-model and spatial comparisons, the hollow-only prototype, US Buildings releases, and personal research pages.

Dates use America/New_York and refer to the recorded work or verification. Earlier preparation entries remain historical snapshots. The primary 2,019-pair evaluation, separate curved-reference sample, historical regional cohort, national mixed-version catalog and bounded browser analyses keep their distinct scopes. New links point to public data, code, experiments and the current project pages. No experiment assets or existing study pages were changed.
