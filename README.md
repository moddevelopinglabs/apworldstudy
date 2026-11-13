# AP World History study site

Study guides for *Ways of the World* (Part 2, 1450 to 1750). Plain HTML, CSS, and JavaScript with no build step, so it runs on GitHub Pages or straight from the folder.

## Pages

- `index.html`: chapter hub with progress for each chapter and a cumulative quiz across all chapters
- `ch6.html`: Chapter 6, Commerce and Consequence
- `ch7.html`: Chapter 7, Cultural Transformations: Religion and Science

Each chapter has section summaries with key points and margin questions, comparison charts, SAQ and written practice with scoring guides, a searchable key terms list with flashcards, and a quiz. Chapter 7 also has a timeline and a primary sources section.

## Files

- `assets/site.css`: shared styles, including light and dark themes
- `assets/app.js`: shared behavior (progress tracking, flashcards, quizzes, theme toggle)
- `assets/chN-data.js`: each chapter's quiz questions, key terms, and quiz topics

Progress, written answers, flashcard progress, missed questions, and best scores are saved in the browser's localStorage only.

## Adding a chapter

1. Copy a chapter page to `chN.html`, set `<body data-chapter="chN">`, and load `assets/chN-data.js` before `assets/app.js`.
2. Create `assets/chN-data.js` with `meta` (number, title, page, and the ids of the sections that have a "Mark as reviewed" button), `quiz`, `terms`, and `topics`.
3. Add the chapter to the switcher in each page's sidebar, add a card to `index.html`, and load its data file on the hub.
