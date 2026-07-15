import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

DB_PATH = Path("results.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS batch_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            das_env TEXT,
            total_iterations INTEGER,
            grade_accuracy_avg REAL,
            assumption_score_avg REAL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS test_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            das_env TEXT,
            round_no INTEGER,
            conversation_id TEXT,
            conversation_no INTEGER,
            application_name TEXT,
            expected_grades TEXT,
            suggested_grades TEXT,
            grades_matched_count INTEGER,
            grades_passed BOOLEAN,
            assumptions_score REAL,
            assumptions_passed BOOLEAN,
            flow_completed BOOLEAN,
            error_message TEXT,
            expected_assumptions TEXT,
            agent_assumptions TEXT,
            FOREIGN KEY(batch_id) REFERENCES batch_runs(id)
        )
    ''')
    
    # Schema migration: add new columns if they don't exist
    for col_name in ['actual_turns_json', 'grade_eval_details', 'assumption_eval_details', 'turn_traces_json']:
        try:
            cursor.execute(f'ALTER TABLE test_results ADD COLUMN {col_name} TEXT')
        except sqlite3.OperationalError:
            pass  # Column already exists

    for col_name in ['total_duration_ms', 'avg_turn_latency_ms', 'grade_eval_ms', 'assumption_eval_ms']:
        try:
            cursor.execute(f'ALTER TABLE test_results ADD COLUMN {col_name} REAL')
        except sqlite3.OperationalError:
            pass  # Column already exists

    for col_name in ['simulator_tokens', 'grade_eval_tokens', 'assumption_eval_tokens', 'total_tokens']:
        try:
            cursor.execute(f'ALTER TABLE test_results ADD COLUMN {col_name} INTEGER')
        except sqlite3.OperationalError:
            pass  # Column already exists

    try:
        cursor.execute('ALTER TABLE batch_runs ADD COLUMN avg_latency_ms REAL')
    except sqlite3.OperationalError:
        pass  # Column already exists

    try:
        cursor.execute('ALTER TABLE batch_runs ADD COLUMN notes TEXT')
    except sqlite3.OperationalError:
        pass  # Column already exists

    conn.commit()
    conn.close()

def update_batch_run_notes(batch_id: int, notes: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE batch_runs SET notes = ? WHERE id = ?', (notes, batch_id))
    conn.commit()
    conn.close()

def get_failed_conversation_nos(batch_id: int) -> List[int]:
    """Conversation numbers that did not pass in every round of this session
    (partial or total failure), for a 'retry failed' re-run."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT conversation_no,
               SUM(CASE WHEN grades_passed = 1 THEN 1 ELSE 0 END) as passed,
               COUNT(*) as total
        FROM test_results
        WHERE batch_id = ?
        GROUP BY conversation_no
    ''', (batch_id,))
    rows = cursor.fetchall()
    conn.close()
    return [r[0] for r in rows if r[1] < r[2]]

def create_batch_run(das_env: str, total_iterations: int) -> int:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO batch_runs (das_env, total_iterations)
        VALUES (?, ?)
    ''', (das_env, total_iterations))
    batch_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return batch_id

def update_batch_run_metrics(batch_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT grades_passed, assumptions_score, avg_turn_latency_ms
        FROM test_results
        WHERE batch_id = ?
    ''', (batch_id,))

    results = cursor.fetchall()

    if not results:
        conn.close()
        return

    graded_results = [r for r in results if r[0] is not None]
    passed_grades_count = sum(1 for r in graded_results if r[0] == 1)

    grade_accuracy_avg = (passed_grades_count / len(graded_results)) * 100 if graded_results else None

    valid_assumption_scores = [r[1] for r in results if r[1] is not None]
    assumption_score_avg = (sum(valid_assumption_scores) / len(valid_assumption_scores)) if valid_assumption_scores else None

    valid_latencies = [r[2] for r in results if r[2] is not None]
    avg_latency_ms = sum(valid_latencies) / len(valid_latencies) if valid_latencies else None

    cursor.execute('''
        UPDATE batch_runs
        SET grade_accuracy_avg = ?, assumption_score_avg = ?, avg_latency_ms = ?
        WHERE id = ?
    ''', (grade_accuracy_avg, assumption_score_avg, avg_latency_ms, batch_id))

    conn.commit()
    conn.close()

def insert_test_result(
    batch_id: Optional[int],
    das_env: str,
    round_no: int,
    conversation_id: str,
    conversation_no: int,
    application_name: str,
    expected_grades: List[str],
    suggested_grades: List[str],
    grades_matched_count: int,
    grades_passed: Optional[bool],
    assumptions_score: Optional[float],
    assumptions_passed: Optional[bool],
    flow_completed: bool,
    error_message: str,
    expected_assumptions: List[str] = None,
    agent_assumptions: str = "",
    actual_turns_json: str = None,
    grade_eval_details: str = None,
    assumption_eval_details: str = None,
    turn_traces_json: str = None,
    total_duration_ms: Optional[float] = None,
    avg_turn_latency_ms: Optional[float] = None,
    grade_eval_ms: Optional[float] = None,
    assumption_eval_ms: Optional[float] = None,
    simulator_tokens: Optional[int] = None,
    grade_eval_tokens: Optional[int] = None,
    assumption_eval_tokens: Optional[int] = None,
    total_tokens: Optional[int] = None
) -> int:
    if expected_assumptions is None:
        expected_assumptions = []

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute('''
        INSERT INTO test_results (
            batch_id, das_env, round_no, conversation_id, conversation_no,
            application_name, expected_grades, suggested_grades,
            grades_matched_count, grades_passed, assumptions_score,
            assumptions_passed, flow_completed, error_message,
            expected_assumptions, agent_assumptions,
            actual_turns_json, grade_eval_details, assumption_eval_details, turn_traces_json,
            total_duration_ms, avg_turn_latency_ms, grade_eval_ms, assumption_eval_ms,
            simulator_tokens, grade_eval_tokens, assumption_eval_tokens, total_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        batch_id,
        das_env,
        round_no,
        conversation_id,
        conversation_no,
        application_name,
        json.dumps(expected_grades),
        json.dumps(suggested_grades),
        grades_matched_count,
        1 if grades_passed else (0 if grades_passed is False else None),
        assumptions_score,
        1 if assumptions_passed else (0 if assumptions_passed is False else None),
        1 if flow_completed else 0,
        error_message,
        json.dumps(expected_assumptions),
        agent_assumptions,
        actual_turns_json,
        grade_eval_details,
        assumption_eval_details,
        turn_traces_json,
        total_duration_ms,
        avg_turn_latency_ms,
        grade_eval_ms,
        assumption_eval_ms,
        simulator_tokens,
        grade_eval_tokens,
        assumption_eval_tokens,
        total_tokens
    ))

    row_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return row_id

def get_past_runs() -> List[Dict[str, Any]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT
            b.id,
            b.timestamp,
            b.das_env,
            b.total_iterations,
            b.grade_accuracy_avg,
            b.assumption_score_avg,
            b.avg_latency_ms,
            b.notes,
            COUNT(DISTINCT t.conversation_no) as unique_convs,
            MAX(t.grades_passed) as single_grade_passed,
            MAX(t.flow_completed) as single_flow_completed,
            MAX(t.application_name) as single_app_name
        FROM batch_runs b
        LEFT JOIN test_results t ON b.id = t.batch_id
        GROUP BY b.id
        ORDER BY b.timestamp DESC
    ''')
    
    runs = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return runs

def get_test_results_for_batch(batch_id: int) -> List[Dict[str, Any]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT * FROM test_results
        WHERE batch_id = ?
        ORDER BY round_no ASC, conversation_no ASC
    ''', (batch_id,))
    
    results = []
    for row in cursor.fetchall():
        d = dict(row)
        d['expected_grades'] = json.loads(d['expected_grades']) if d['expected_grades'] else []
        d['suggested_grades'] = json.loads(d['suggested_grades']) if d['suggested_grades'] else []
        d['expected_assumptions'] = json.loads(d.get('expected_assumptions', '[]')) if d.get('expected_assumptions') else []
        results.append(d)
        
    conn.close()
    return results

def get_results_by_round(batch_id: int) -> Dict[int, List[Dict[str, Any]]]:
    """Reconstruct the result-dict shape core/reporter.py expects, from stored
    DB columns, so a report can be regenerated even after its results/ folder
    (round JSONs) has been cleaned up from disk."""
    rows = get_test_results_for_batch(batch_id)
    by_round: Dict[int, List[Dict[str, Any]]] = {}
    for r in rows:
        round_no = r.get("round_no") or 1
        grade_eval = json.loads(r["grade_eval_details"]) if r.get("grade_eval_details") else {}
        assumption_eval = json.loads(r["assumption_eval_details"]) if r.get("assumption_eval_details") else {}

        # grade_eval_details/assumption_eval_details are a frozen snapshot of the
        # original automated evaluation; grades_passed/assumptions_score are the
        # live columns a manual override (api/results/override) updates. Without
        # this, a report regenerated after an override still showed the pre-override
        # verdict because build_grades_sheet/_grade_status read the frozen snapshot.
        db_grades_passed = r.get("grades_passed")
        if db_grades_passed is not None and bool(db_grades_passed) != bool(grade_eval.get("passed")):
            grade_eval = dict(grade_eval, passed=bool(db_grades_passed), reasoning=((grade_eval.get("reasoning") or "") + " [Manually overridden]").strip())
        db_assumptions_score = r.get("assumptions_score")
        if db_assumptions_score is not None and db_assumptions_score != assumption_eval.get("overallScore"):
            assumption_eval = dict(assumption_eval, overallScore=db_assumptions_score, passed=db_assumptions_score >= 5.0, reasoning=((assumption_eval.get("reasoning") or "") + " [Manually overridden]").strip())

        result = {
            "conversationNo": r.get("conversation_no"),
            "application": r.get("application_name", ""),
            "flowCompleted": bool(r.get("flow_completed")),
            "error": r.get("error_message", ""),
            "expectedGrades": r.get("expected_grades", []),
            "suggestedGrades": r.get("suggested_grades", []),
            "gradeEvaluation": grade_eval,
            "assumptionEvaluation": assumption_eval,
            "agentAssumptionOutput": r.get("agent_assumptions", ""),
            "timing": {
                "totalDurationMs": r.get("total_duration_ms"),
                "avgTurnLatencyMs": r.get("avg_turn_latency_ms"),
            },
            "turnTraces": json.loads(r["turn_traces_json"]) if r.get("turn_traces_json") else [],
        }
        by_round.setdefault(round_no, []).append(result)

    for round_no in by_round:
        by_round[round_no].sort(key=lambda x: x.get("conversationNo") or 999)
    return by_round

def update_test_result_override(test_id: int, new_grades_passed: Optional[bool], new_assumptions_score: Optional[float]):
    """Update a specific test result manually, and trigger a batch metrics recalculation."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Update the row
    cursor.execute('''
        UPDATE test_results
        SET grades_passed = ?, assumptions_score = ?
        WHERE id = ?
    ''', (
        1 if new_grades_passed else (0 if new_grades_passed is False else None),
        new_assumptions_score,
        test_id
    ))
    
    # Get the batch_id to recalculate
    cursor.execute('SELECT batch_id FROM test_results WHERE id = ?', (test_id,))
    row = cursor.fetchone()
    batch_id = row[0] if row else None
    
    conn.commit()
    conn.close()
    
    if batch_id is not None:
        update_batch_run_metrics(batch_id)

def delete_batch_run(batch_id):
    """Delete a batch run and all its test results."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM test_results WHERE batch_id = ?', (batch_id,))
    cursor.execute('DELETE FROM batch_runs WHERE id = ?', (batch_id,))
    conn.commit()
    conn.close()

def delete_test_result(result_id):
    """Delete a single test result."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT batch_id FROM test_results WHERE id = ?', (result_id,))
    row = cursor.fetchone()
    batch_id = row[0] if row else None
    cursor.execute('DELETE FROM test_results WHERE id = ?', (result_id,))
    conn.commit()
    conn.close()
    if batch_id:
        update_batch_run_metrics(batch_id)

def get_single_result_detail(result_id):
    """Get full detail for one test result including conversation turns."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM test_results WHERE id = ?', (result_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    for field in ['expected_grades', 'suggested_grades', 'expected_assumptions']:
        d[field] = json.loads(d[field]) if d[field] else []
    for field in ['actual_turns_json', 'grade_eval_details', 'assumption_eval_details', 'turn_traces_json']:
        d[field] = json.loads(d[field]) if d.get(field) else None
    return d

def get_test_result_by_conversation_id(conversation_id: str):
    """Look up the stored result row for a conversation_id (unique per run_test() call —
    one uuid4 per round/conversation), so the MLflow Traces tab and result drill-down can
    both backfill turn_traces_json for older runs from just the ID visible in MLflow."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM test_results WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', (conversation_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    for field in ['actual_turns_json', 'grade_eval_details', 'assumption_eval_details', 'turn_traces_json']:
        d[field] = json.loads(d[field]) if d.get(field) else None
    return d

def update_test_result_turn_traces(test_id: int, turn_traces: list) -> bool:
    """Backfill turn_traces_json for a result that predates this feature (or whose
    live run's MLflow fetch failed/timed out), by conversation_id lookup against MLflow."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE test_results SET turn_traces_json = ? WHERE id = ?', (json.dumps(turn_traces), test_id))
    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return updated

def get_comparison_data(session_a, session_b):
    """Get results for two sessions for comparison."""
    results_a = get_test_results_for_batch(session_a)
    results_b = get_test_results_for_batch(session_b)
    return {"session_a": results_a, "session_b": results_b}

# Initialize DB on import
init_db()
