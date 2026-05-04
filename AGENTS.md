# AGENTS.md

## 1. Role & Expertise

You are an AI coding agent working with a domain expert:

- PhD in Civil Engineering + Information Engineering
- Strong background in Computer Vision (CV), Deep Learning (DL), and 3D Reconstruction
- Experienced in semantic segmentation, detection, Vision Foundation Models (VFM), bridge inspection, seismic evaluation, and FEM tools

Use Traditional Chinese as the primary language and assume a high technical level.

## 2. Communication Style

- Use Traditional Chinese by default.
- Keep explanations concise, logical, and implementation-oriented.
- Keep key technical terms in English with abbreviation where useful.

## 3. Core Working Principles

- Think before coding: clarify assumptions and outline the implementation direction.
- Prefer minimal but correct solutions.
- Execute incrementally: plan, implement, verify, iterate.
- Every change should be testable, reproducible, and explainable.

## 4. Project Memory & Updates

Update this file when architecture, pipeline, new modules, or workflow change.

## 5. Project Structure

```text
/食材飲食管理
  AGENTS.md
  README.md
  .env.example
  start_app.sh
  打開食材飲食管理.command
  /backend
    app.py
    requirements.txt
  /frontend
    package.json
    index.html
    vite.config.js
    /src
      App.jsx
      main.jsx
      styles.css
  /data
    app.db              # created automatically
  /uploads
    ingredients/
    meals/
```

## 6. Pipeline

1. FastAPI starts and initializes SQLite tables if needed.
2. Frontend calls `/api/summary`, `/api/ingredients`, `/api/meals`, `/api/usage/weekly`, and `/api/weekly-plan`.
3. User can manually add/edit/delete ingredients.
4. Ingredient creation uses a simplified form: name, category, one quantity field, unit dropdown, local-date purchase date, and auto-estimated expiration date based on name/category/storage.
5. Adding an ingredient with an existing item name merges into the existing inventory row by increasing total and remaining quantity instead of creating a duplicate.
6. User can filter inventory by category icons and manually adjust category, remaining quantity, expiration date, storage, and opened state directly in the inventory table.
7. User can upload meal photos and edit/delete meal records after entry.
8. Meal AI analysis is day-level from the UI: analyze the selected day's meals, review/edit AI-estimated ingredient usage, then confirm to update inventory. After confirmation, the editable usage review is hidden for that day.
9. Overview uses a desktop 2x2 dashboard: top-left meal logs/usage, top-right AI weekly menu, bottom-left Monday-to-Sunday confirmed ingredient consumption tracking, bottom-right inventory requiring attention.
10. Weekly plan generation uses only currently available inventory items and lists ingredients used by each meal.
11. Local launch uses `./start_app.sh`; macOS users can double-click `打開食材飲食管理.command`.

## 7. Key Decisions

- Local-first single-user app for v1; no login or cloud sync.
- SQLite is the source of truth; images are stored under `uploads/` and referenced by path.
- OpenAI API key lives only in backend `.env` / environment variable.
- AI is semi-automatic: it proposes structured results, but user confirmation is required before inventory is modified.
- AI weekly menu prompts and backend post-processing must not recommend ingredients that are not present in current inventory.
- Weekly menu generation should avoid rapid repetition from recent meals and keep breakfast lightweight; backend post-processing should remove heavy lunch/dinner items from breakfast when suitable breakfast inventory exists.
- Meal records must remain editable/deletable because user-entered food logs are expected to have mistakes.
- Expiration-related suggestions are informational and not a food safety guarantee.

## 8. Scientific Visualization & Figure Design

When adding figures or charts, target SCI Q1 journal quality: clear hierarchy, legible labels, balanced spacing, professional palette, and no cropped or overlapping text.
