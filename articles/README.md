# Hidden Article Page

Unlisted route:

`/listening-notes-7q4m/`

No link points here from the public homepage, and the page has `noindex`.

## Shared code architecture

This page reuses the global `main.js` bootstrap for background FX.

Page-specific FX settings are passed via `#fx` data attributes in
`listening-notes-7q4m/index.html`:

- `data-wrap-selector=".essay-layout"`
- `data-active-zone-selector=".article-pane"`
- `data-mask-area-selector=".article-pane"`
- `data-word-source-selector="#article-content"`
- `data-emit-only-mini-mode="true"`

This keeps FX visible and interactive only in the article pane.
Left-mouse word mode uses words from the loaded article text.

## How to edit your current article

1. Edit map nodes and connections:
`content/czech-scene-sound.map.json`

2. Edit article text and structure:
`content/czech-scene-sound.html`

## Required structure

Every node in `.map.json` must reference a section id in `.html`.

Example:

- map node: `"section": "field-recording-practice"`
- article section: `<section id="field-recording-practice"> ... </section>`

If IDs do not match, clicking that node will do nothing.

Optional node importance levels:

- Add `"importance": <number>` to a node in `.map.json` (`1` is highest).
- Levels `1` and `2` are accent blue.
- Levels `3+` use black/white node colors (theme-dependent) with increasing transparency.
- Importance also changes node size (higher importance = larger node).

Compatibility:

- `"important": true` is still accepted and treated as `importance: 1`.

Only the currently selected section is shown.
Selecting a node in the map switches the visible section below.

## Adding another article later

1. Duplicate template files:
- `content/article-template.map.json`
- `content/article-template.html`

2. Rename both to the same key, for example:
- `content/my-next-article.map.json`
- `content/my-next-article.html`

3. Open:
`/listening-notes-7q4m/?article=my-next-article`

## Formatting options in article HTML

Inside each section you can use:

- `<p>` for paragraph text
- `<blockquote>` for quotes
- `<ul><li>...</li></ul>` or `<ol><li>...</li></ol>` for lists
- `<a href="...">...</a>` for links

## Mention-to-Graph Hover Flags

You can mark a text fragment so hovering it highlights matching graph edge(s).

Use inline HTML with `data-graph-path`:

`<span data-graph-path="entry>field>space">mapped phrase</span>`

Notes:

- Node ids in `data-graph-path` must match node ids from `.map.json` (for example `entry`, `field`).
- A chain like `a>b>c` highlights edges `a-b` and `b-c`.
- Multiple paths are supported with separators:
  - `data-graph-path="entry>field;lineage>institution"`

## Notes for local testing

The page loads content via `fetch()`, so use a local server while testing.
Opening the file directly via `file://` may fail in some browsers.
