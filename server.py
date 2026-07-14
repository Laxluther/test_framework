import json
import asyncio
import threading
import queue
import shutil
import nest_asyncio
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, send_file

from main import run_single_test_async, run_all_tests_async, list_available_conversations
from core.config import DAS_ENVIRONMENTS, DAS_API_KEYS
from core.das_client import check_api_health
from core.db import (get_past_runs, get_test_results_for_batch, get_single_result_detail,
                     update_test_result_override, delete_batch_run, delete_test_result,
                     get_comparison_data, get_results_by_round, update_batch_run_notes,
                     get_failed_conversation_nos)
from core.mlflow_client import get_traces_for_conversation
from core.loader import collect_test_files, extract_conversation_no, load_conversation_json, extract_app_name
from core.reporter import generate_report_from_results_by_round
from core.testdata import (list_conversations_with_coverage, get_conversation_detail,
                           create_conversation, update_conversation, delete_conversation,
                           parse_conversation_upload, ValidationError)

nest_asyncio.apply()

app = Flask(__name__)

# Global state for running tests
run_state = {
    "running": False,
    "cancel_flag": threading.Event(),
    "progress_queue": queue.Queue(),
    "snapshot": {}
}

def reset_snapshot():
    run_state["snapshot"] = {
        "mode": "",
        "round": 0,
        "total_rounds": 0,
        "completed": 0,
        "total": 0,
        "items": {},
        "roundResults": [],
        "completedRounds": []
    }

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/config")
def api_config():
    convs = list_available_conversations()
    # Build a list with application names extracted from JSON files
    conv_list = []
    for name in convs:
        conv_path = Path("conversation") / name
        try:
            data = load_conversation_json(conv_path)
            app_name = data.get("application", extract_app_name(name))
        except:
            app_name = extract_app_name(name)
        conv_no = extract_conversation_no(name)
        conv_list.append({"filename": name, "application": app_name, "conv_no": conv_no})
    return jsonify({
        "environments": list(DAS_ENVIRONMENTS.keys()),
        "conversations": conv_list,
    })

@app.route("/api/health")
def api_health():
    env = request.args.get("env", "Local")
    api_url = DAS_ENVIRONMENTS.get(env, "")
    if not api_url:
        return jsonify({"env": env, "healthy": False, "reason": "No URL configured for this environment"})
    healthy = asyncio.run(check_api_health(api_url))
    return jsonify({"env": env, "healthy": healthy})

def progress_callback(event_type, data):
    """Callback that pushes progress events to the SSE queue and updates snapshot."""
    run_state["progress_queue"].put({"event": event_type, "data": data})
    
    snap = run_state.get("snapshot", {})
    if not snap: return
    
    if event_type == "round_start":
        # A new round is starting: archive the just-finished round (if any) into
        # completedRounds before resetting, since "run_complete" never reaches this
        # callback (the worker pushes it straight to the queue) and can't do this.
        if snap.get("roundResults"):
            snap.setdefault("completedRounds", []).append({
                "round": snap.get("round", 0),
                "results": list(snap["roundResults"])
            })
        snap["round"] = data.get("round", 0)
        snap["total_rounds"] = data.get("total_rounds", snap.get("total_rounds", 0))
        snap["items"] = {}
        snap["completed"] = 0
        snap["roundResults"] = []
    elif event_type == "file_start":
        snap["total"] = data.get("total", 0)
        grid_id = str(data.get("conv_no", data.get("conv_file", "")))
        snap["items"][grid_id] = {
            "conv_file": data.get("conv_file", ""),
            "status": "running",
            "logs": []
        }
    elif event_type in ("turn_start", "agent_reply"):
        grid_id = str(data.get("conv_no", ""))
        if grid_id in snap["items"]:
            logs = snap["items"][grid_id]["logs"]
            who = "user" if event_type == "turn_start" else "agent"
            msg = data.get("user_input") if who == "user" else data.get("agent_msg")
            logs.append({"type": who, "text": f"[Turn {data.get('turn', 0)}] {msg}", "latencyMs": data.get("latency_ms")})
            if len(logs) > 10: logs.pop(0)
    elif event_type == "completed":
        grid_id = str(data.get("conv_no", ""))
        snap["completed"] += 1
        if grid_id in snap["items"]:
            snap["items"][grid_id]["status"] = "pass" if data.get("success") else "fail"
            snap["items"][grid_id]["application"] = data.get("application", "")
        snap["roundResults"].append(data)
    elif event_type == "cancelled" and snap.get("roundResults"):
        # Preserve the partially-completed round so a refresh right after
        # stopping still shows what finished before the stop took effect.
        snap.setdefault("completedRounds", []).append({
            "round": snap.get("round", 0),
            "results": list(snap["roundResults"])
        })
        snap["roundResults"] = []

def run_test_in_thread(mode, **kwargs):
    """Run test in a background thread using asyncio."""
    reset_snapshot()
    run_state["snapshot"]["mode"] = mode
    if mode == "batch":
        run_state["snapshot"]["total_rounds"] = kwargs.get("num_rounds", 1)
        run_state["snapshot"]["execution_mode"] = kwargs.get("execution_mode", "sequential")


    run_state["running"] = True
    run_state["cancel_flag"].clear()
    # drain old events
    while not run_state["progress_queue"].empty():
        run_state["progress_queue"].get_nowait()
    
    def worker():
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            nest_asyncio.apply(loop)
            
            if mode == "single":
                result_dir = loop.run_until_complete(
                    run_single_test_async(
                        conv_file=kwargs["conv_file"],
                        num_rounds=kwargs["num_rounds"],
                        use_llm_eval=kwargs["use_llm_eval"],
                        das_env=kwargs["das_env"],
                        on_progress=progress_callback,
                        cancel_flag=run_state["cancel_flag"],
                    )
                )
            else:
                result_dir = loop.run_until_complete(
                    run_all_tests_async(
                        num_rounds=kwargs["num_rounds"],
                        use_llm_eval=kwargs["use_llm_eval"],
                        das_env=kwargs["das_env"],
                        on_progress=progress_callback,
                        cancel_flag=run_state["cancel_flag"],
                        execution_mode=kwargs.get("execution_mode", "sequential"),
                        conv_no_filter=kwargs.get("conv_no_filter"),
                        notes=kwargs.get("notes"),
                    )
                )
            
            run_state["progress_queue"].put({
                "event": "run_complete",
                "data": {"output_dir": str(result_dir)}
            })
        except Exception as e:
            run_state["progress_queue"].put({
                "event": "error",
                "data": {"message": str(e)}
            })
        finally:
            run_state["running"] = False
    
    t = threading.Thread(target=worker, daemon=True)
    t.start()

@app.route("/api/run/single", methods=["POST"])
def api_run_single():
    if run_state["running"]:
        return jsonify({"error": "A test is already running"}), 409
    
    body = request.json
    conv_file = Path("conversation") / body["conversation"]
    run_test_in_thread(
        mode="single",
        conv_file=conv_file,
        num_rounds=body.get("rounds", 1),
        use_llm_eval=body.get("use_llm_eval", True),
        das_env=body.get("environment", "Local"),
    )
    return jsonify({"status": "started"})

@app.route("/api/run/batch", methods=["POST"])
def api_run_batch():
    if run_state["running"]:
        return jsonify({"error": "A test is already running"}), 409

    body = request.json
    execution_mode = body.get("execution_mode", "sequential")
    if execution_mode not in ("sequential", "parallel"):
        execution_mode = "sequential"
    run_test_in_thread(
        mode="batch",
        num_rounds=body.get("rounds", 1),
        use_llm_eval=body.get("use_llm_eval", True),
        das_env=body.get("environment", "Local"),
        execution_mode=execution_mode,
    )
    return jsonify({"status": "started"})

@app.route("/api/run/retry-failed/<int:session_id>", methods=["POST"])
def api_retry_failed(session_id):
    if run_state["running"]:
        return jsonify({"error": "A test is already running"}), 409

    failed_nos = get_failed_conversation_nos(session_id)
    if not failed_nos:
        return jsonify({"error": "No failed conversations found for this session — nothing to retry"}), 400

    body = request.json or {}
    execution_mode = body.get("execution_mode", "sequential")
    if execution_mode not in ("sequential", "parallel"):
        execution_mode = "sequential"
    run_test_in_thread(
        mode="batch",
        num_rounds=body.get("rounds", 1),
        use_llm_eval=body.get("use_llm_eval", True),
        das_env=body.get("environment", "Local"),
        execution_mode=execution_mode,
        conv_no_filter=failed_nos,
        notes=f"Retry of {len(failed_nos)} failed conversation(s) from session {session_id}",
    )
    return jsonify({"status": "started", "retrying_conv_nos": failed_nos})

@app.route("/api/run/stop", methods=["POST"])
def api_run_stop():
    run_state["cancel_flag"].set()
    return jsonify({"status": "cancel_requested"})

@app.route("/api/run/status")
def api_run_status_sse():
    """SSE endpoint for real-time progress."""
    def generate():
        while True:
            try:
                msg = run_state["progress_queue"].get(timeout=30)
                yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'])}\n\n"
                if msg["event"] in ("run_complete", "error"):
                    break
            except queue.Empty:
                yield f"event: heartbeat\ndata: {{}}\n\n"
    
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.route("/api/results/sessions")
def api_results_sessions():
    runs = get_past_runs()
    return jsonify(runs)

@app.route("/api/results/<int:session_id>")
def api_results_detail(session_id):
    results = get_test_results_for_batch(session_id)
    return jsonify(results)

@app.route("/api/results/detail/<int:result_id>")
def api_result_single_detail(result_id):
    result = get_single_result_detail(result_id)
    if not result:
        return jsonify({"error": "Not found"}), 404
    return jsonify(result)

@app.route("/api/results/override", methods=["POST"])
def api_results_override():
    body = request.json
    update_test_result_override(
        test_id=body["result_id"],
        new_grades_passed=body.get("grades_passed"),
        new_assumptions_score=body.get("assumptions_score")
    )
    return jsonify({"status": "updated"})

@app.route("/api/results/notes/<int:session_id>", methods=["POST"])
def api_update_session_notes(session_id):
    body = request.json or {}
    update_batch_run_notes(session_id, body.get("notes", ""))
    return jsonify({"status": "updated"})

def _delete_session_folder(session_id: int):
    """Remove the on-disk results/session_{id}_... folder (round JSONs + Excel
    report) so deleting a session from the DB doesn't leave it orphaned forever."""
    results_dir = Path("results")
    if not results_dir.exists():
        return
    for d in results_dir.iterdir():
        if d.is_dir() and d.name.startswith(f"session_{session_id}_"):
            shutil.rmtree(d, ignore_errors=True)

@app.route("/api/results/delete/<int:session_id>", methods=["DELETE"])
def api_delete_session(session_id):
    delete_batch_run(session_id)
    _delete_session_folder(session_id)
    return jsonify({"status": "deleted"})

@app.route("/api/results/delete-result/<int:result_id>", methods=["DELETE"])
def api_delete_result(result_id):
    delete_test_result(result_id)
    return jsonify({"status": "deleted"})

@app.route("/api/comparison")
def api_comparison():
    session_a = request.args.get("a", type=int)
    session_b = request.args.get("b", type=int)
    if not session_a or not session_b:
        return jsonify({"error": "Provide ?a=ID&b=ID"}), 400
    data = get_comparison_data(session_a, session_b)
    return jsonify(data)

@app.route("/api/mlflow/traces/<conversation_id>")
def api_mlflow_traces(conversation_id):
    env = request.args.get("env", "Local")
    traces = get_traces_for_conversation(conversation_id, env)
    return jsonify(traces)

@app.route("/api/report/<int:session_id>")
def api_download_report(session_id):
    results_dir = Path("results")
    if results_dir.exists():
        # Matches both the original run's folder and a regenerated one (named
        # "session_{id}_regenerated", which also starts with this prefix).
        for d in results_dir.iterdir():
            if d.is_dir() and d.name.startswith(f"session_{session_id}_"):
                report = d / "consolidated_report.xlsx"
                if report.exists():
                    return send_file(str(report), as_attachment=True, download_name=f"consolidated_report_session_{session_id}.xlsx")

    return jsonify({"error": f"Report for session {session_id} not found. Try regenerating it."}), 404

@app.route("/api/report/regenerate/<int:session_id>", methods=["POST"])
def api_regenerate_report(session_id):
    """Rebuild consolidated_report.xlsx straight from the DB, for sessions whose
    results/ folder (round JSONs) no longer exists on disk."""
    results_by_round = get_results_by_round(session_id)
    if not results_by_round:
        return jsonify({"error": f"No stored results found for session {session_id}"}), 404

    out_dir = Path("results") / f"session_{session_id}_regenerated"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "consolidated_report.xlsx"
    generate_report_from_results_by_round(results_by_round, report_path)
    return jsonify({"status": "regenerated"})

@app.route("/api/testdata/conversations")
def api_list_testdata():
    return jsonify(list_conversations_with_coverage())

@app.route("/api/testdata/conversations/<int:conv_no>")
def api_get_testdata(conv_no):
    detail = get_conversation_detail(conv_no)
    if detail is None:
        return jsonify({"error": f"Conversation {conv_no} not found"}), 404
    return jsonify(detail)

@app.route("/api/testdata/conversations", methods=["POST"])
def api_create_testdata():
    try:
        result = create_conversation(request.json or {})
        return jsonify(result)
    except ValidationError as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/testdata/conversations/<int:conv_no>", methods=["PUT"])
def api_update_testdata(conv_no):
    try:
        update_conversation(conv_no, request.json or {})
        return jsonify({"status": "updated"})
    except ValidationError as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/testdata/conversations/<int:conv_no>", methods=["DELETE"])
def api_delete_testdata(conv_no):
    delete_conversation(conv_no)
    return jsonify({"status": "deleted"})

@app.route("/api/testdata/parse-upload", methods=["POST"])
def api_parse_testdata_upload():
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"error": "No file uploaded"}), 400
    try:
        result = parse_conversation_upload(file.filename, file.read())
        return jsonify(result)
    except ValidationError as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/run/is-running")
def api_is_running():
    return jsonify({
        "running": run_state["running"],
        "snapshot": run_state.get("snapshot", {})
    })

if __name__ == "__main__":
    print("Starting DAS Testing System on http://localhost:5000")
    # host=127.0.0.1 (not 0.0.0.0) so the Werkzeug debugger isn't reachable from
    # the network, and use_reloader=False so editing a .py file mid-run doesn't
    # restart the process and kill an in-flight test run.
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False, threaded=True)
