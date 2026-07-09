# AIChat Test Framework

A comprehensive, multi-agent evaluation framework for testing conversation agents.

## Overview

This framework allows you to run conversational test suites against different DAS environments (Local, Dev, Test, QA, UAT, Prod). It evaluates the agent's performance in two main areas:
1. **Grade Recommendation Accuracy**: Did the agent recommend the correct material grades?
2. **Assumption Identification**: Did the agent correctly identify the user's CTQs (Critical to Quality) such as temperature resistance, UL ratings, etc.?

## Architecture

- **Backend**: Flask server (`server.py`) handling all orchestration and UI APIs.
- **Frontend**: A clean, LangSmith-inspired SPA (Single Page Application) built with vanilla HTML/CSS/JS (`templates/index.html`, `static/style.css`, `static/app.js`).
- **Storage**: SQLite (`results.db`) for storing full conversation turns, evaluation details, and historical session data.
- **Agent Tracing**: MLflow integration for visualizing agent execution times and spans.

## Setup

1. **Install Dependencies**
   ```bash
   uv pip install -e .
   # OR
   pip install -r requirements.txt
   ```

2. **Configuration**
   Copy the `.env.sample` to `.env` and fill in your secrets.
   ```bash
   cp .env.sample .env
   ```
   **Important:** `DAS_URL_*` and `DAS_API_KEY_*` must be set in your `.env` file for the environments you wish to test. 

## Running the Dashboard

Start the Flask server:
```bash
python server.py
```
Then open your browser to **`http://localhost:5000`**.

### Dashboard Features
- **Single Run**: Test a single conversation and watch the turn-by-turn log in real-time.
- **Batch Run**: Run the entire suite across multiple rounds. Includes a real-time progress grid and a safe "Stop" button.
- **Results Drill-Down**: Click on any past result to see the full grade evaluation, assumption evaluation, conversation turns, and apply manual overrides.
- **Dashboard Heatmap**: Visualize pass/fail rates across multiple rounds.
- **Comparison**: Compare two sessions side-by-side to detect regressions.
- **History Management**: Delete or edit old test runs.
- **MLflow Traces**: View deep hierarchical traces of agent execution times for any conversation.

## Adding New Tests
Place new conversation JSON files in the `conversation/` directory. The system will automatically detect them and add them to the dropdowns. Ground truth data for evaluations should be placed in `groundTruth/`.
