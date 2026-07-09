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
    for col_name in ['actual_turns_json', 'grade_eval_details', 'assumption_eval_details']:
        try:
            cursor.execute(f'ALTER TABLE test_results ADD COLUMN {col_name} TEXT')
        except sqlite3.OperationalError:
            pass  # Column already exists
    
    conn.commit()
    conn.close()

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
        SELECT grades_passed, assumptions_score 
        FROM test_results 
        WHERE batch_id = ?
    ''', (batch_id,))
    
    results = cursor.fetchall()
    
    if not results:
        conn.close()
        return
        
    total_tests = len(results)
    passed_grades_count = sum(1 for r in results if r[0] == 1)
    
    grade_accuracy_avg = (passed_grades_count / total_tests) * 100 if total_tests > 0 else 0.0
    
    valid_assumption_scores = [r[1] for r in results if r[1] is not None]
    if valid_assumption_scores:
        assumption_score_avg = sum(valid_assumption_scores) / len(valid_assumption_scores)
    else:
        assumption_score_avg = 0.0
        
    cursor.execute('''
        UPDATE batch_runs
        SET grade_accuracy_avg = ?, assumption_score_avg = ?
        WHERE id = ?
    ''', (grade_accuracy_avg, assumption_score_avg, batch_id))
    
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
    assumption_eval_details: str = None
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
            actual_turns_json, grade_eval_details, assumption_eval_details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        assumption_eval_details
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
    for field in ['actual_turns_json', 'grade_eval_details', 'assumption_eval_details']:
        d[field] = json.loads(d[field]) if d.get(field) else None
    return d

def get_comparison_data(session_a, session_b):
    """Get results for two sessions for comparison."""
    results_a = get_test_results_for_batch(session_a)
    results_b = get_test_results_for_batch(session_b)
    return {"session_a": results_a, "session_b": results_b}

# Initialize DB on import
init_db()
