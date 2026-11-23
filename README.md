# Customer Sentiment Insights & Proactive Repair (CX AI POC)

Dashboard that ingests customer feedback (CSV/Excel uploads, mock Trustpilot reviews, scraped web pages),
scores sentiment, groups issues, and triggers "proactive repair" workflows for negative feedback.

## Run it locally

Requires Python 3.10+ (tested on 3.12).

```bash
cd backend

# 1. create + activate a virtual environment
python -m venv .venv
source .venv/bin/activate          # Windows (PowerShell):  .venv\Scripts\Activate.ps1

# 2. install dependencies
pip install -r requirements.txt

# 3. start the server
python app.py
```

Then open **http://localhost:5000**. Flask serves both the API (`/api/...`) and the frontend, so no
second server and no CORS setup is needed. The dashboard needs internet access once to load Chart.js from a CDN.

Try it: go to the **CSV** tab and upload `backend/sample_data/sample_reviews.csv`.
Negative reviews are grouped by issue type and one workflow per type appears in **Proactive Monitoring & Repair**.

### Optional configuration
Copy `backend/.env.example` to `backend/.env` to change the port, plug in real Trustpilot credentials, or send
triggered workflows to an external mock API (e.g. a Postman Mock Server).

### Using a different frontend server
Opening `frontend/index.html` through VS Code Live Server (port 5500) or `python -m http.server 8000` also works;
the frontend then talks to the Flask backend on `localhost:5000` (CORS is enabled for those ports).
Opening the file directly with `file://` will not work because browsers block those requests.


## Deploy publicly on Render

This repository includes a `render.yaml` Blueprint. The Flask server serves both the frontend and API, so deploy it as **one web service**.

1. Push this project to a GitHub repository. Keep `backend/.env` out of Git; `.gitignore` already excludes `.env`.
2. Sign in to Render and choose **New > Blueprint**. Connect the GitHub repository containing this project and select the branch to deploy.
3. Render reads `render.yaml` and creates the `cx-ai-poc` web service. Review the settings and create/deploy it using the Free plan.
4. When the deployment succeeds, open the `onrender.com` URL shown on the service page. Check `https://YOUR-SERVICE.onrender.com/api/health`; it should return JSON with `"status": "ok"`.
5. To demonstrate CSV analysis, upload `backend/sample_data/sample_reviews.csv` from the dashboard's CSV tab.

The Blueprint uses Python 3.12, installs `backend/requirements.txt`, and starts Gunicorn from the backend directory. Render supplies the `PORT` environment variable.

### Public-demo limitations and security

- The application stores uploaded reviews, scrape results and workflow history in memory. They are cleared whenever the process restarts. Render's free web services also spin down after 15 minutes without incoming traffic, and the next visit can take about a minute to wake up. Do not treat this POC as persistent storage.
- The application currently has no user authentication or role permissions. Anyone who can reach the public URL can use its upload/delete/workflow endpoints and can affect the shared in-memory demo state. Use synthetic sample data only; do not upload real or confidential customer information.
- URL scraping is **disabled on the Render deployment** by `ENABLE_WEB_SCRAPING=false` because the current scraper does not block private/internal network destinations. Local scraping remains enabled by default. Do not enable it publicly until SSRF protections (including redirect and DNS/IP validation), destination restrictions, and rate limiting/authentication are implemented.
- Optional Trustpilot or external workflow credentials should be added as Render environment variables, not committed to Git or placed in `render.yaml`. The built-in mock Trustpilot reviews and internal workflow mode work without credentials.

## Project layout

```
backend/
  app.py                  Flask app: registers blueprints, serves the frontend
  helpers.py              JSON-safe cleaning (NaN/dates)
  requirements.txt
  .env.example
  sample_data/            sample_reviews.csv for testing
  routes/
    csv_routes.py         upload/list/delete CSV+Excel, sentiment + issue classification
    trustpilot_routes.py  mock (or real) Trustpilot reviews
    scraping_routes.py    scrape a URL with an optional CSS selector
    data_routes.py        aggregated data, stats, search for the dashboard
    workflow_routes.py    proactive repair workflows (+ optional external API call)
frontend/
  index.html
  css/ style.css, charts.css
  js/  utils.js, api-client.js, charts.js, app.js
```

## Notes
- All data is held in memory: restarting the server clears uploaded files, scrape results and workflows.
- Sentiment/issue detection is keyword + rating based (see `csv_routes.py`); it is a POC heuristic, not an ML model.
- Dashboard sentiment, rating and issue charts are computed from uploaded CSV/Excel rows only.
