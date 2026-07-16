import os
from dotenv import load_dotenv

load_dotenv(override=False)

def get_mlflow_uri_for_env(env_name: str) -> str:
    env_upper = str(env_name or "Local").upper()
    specific_var = f"MLFLOW_TRACKING_URI_{env_upper}"
    uri = os.getenv(specific_var)
    if not uri:
        uri = os.getenv("MLFLOW_TRACKING_URI", "")
    return uri

def _order_spans_as_waterfall(spans):
    """Depth-first ordering (root spans first, each immediately followed by its
    descendants) so the UI can render a parent/child waterfall by walking the
    list in order and using each span's depth for indentation."""
    by_parent = {}
    for span in spans:
        by_parent.setdefault(span.parent_id, []).append(span)
    for children in by_parent.values():
        children.sort(key=lambda s: s.start_time_ns or 0)

    ordered = []

    def visit(parent_id, depth):
        for span in by_parent.get(parent_id, []):
            ordered.append((span, depth))
            visit(span.span_id, depth + 1)

    visit(None, 0)
    return ordered

def get_traces_for_conversation(conversation_id, env_name="Local"):
    """Fetch agent traces from MLflow for a DAS conversation.
    Experiment name format: DAS-{conversation_id}
    """
    uri = get_mlflow_uri_for_env(env_name)
    if not uri:
        return {"error": f"No MLflow tracking URI configured for environment '{env_name}' (or fallback)", "traces": []}

    try:
        import mlflow
        from mlflow import MlflowClient

        # Fail fast on a dead/misconfigured tracking server instead of mlflow's
        # default of ~120s timeout x 7 retries, which would hang the UI for minutes.
        os.environ.setdefault("MLFLOW_HTTP_REQUEST_TIMEOUT", "5")
        os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "1")

        mlflow.set_tracking_uri(uri)
        client = MlflowClient()

        experiment_name = f"DAS-{conversation_id}"
        experiment = client.get_experiment_by_name(experiment_name)
        if not experiment:
            return {"error": f"No experiment found: {experiment_name}", "traces": []}

        traces = client.search_traces(experiment_ids=[experiment.experiment_id], include_spans=True)

        result = {
            "experiment_name": experiment_name,
            "total_traces": len(traces),
            "traces": []
        }

        for trace in traces:
            duration_ms = trace.info.execution_time_ms
            trace_info = {
                "trace_id": str(trace.info.request_id),
                "timestamp": str(trace.info.timestamp_ms),
                "total_duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
                "status": str(trace.info.status),
                "spans": []
            }

            spans = trace.data.spans if trace.data else []
            start_times = [s.start_time_ns for s in spans if s.start_time_ns is not None]
            trace_start_ns = min(start_times) if start_times else None

            for span, depth in _order_spans_as_waterfall(spans):
                span_duration_ms = None
                if span.start_time_ns is not None and span.end_time_ns is not None:
                    span_duration_ms = round((span.end_time_ns - span.start_time_ns) / 1e6, 2)
                start_offset_ms = None
                if trace_start_ns is not None and span.start_time_ns is not None:
                    start_offset_ms = round((span.start_time_ns - trace_start_ns) / 1e6, 2)
                trace_info["spans"].append({
                    "span_id": span.span_id,
                    "parent_id": span.parent_id,
                    "depth": depth,
                    "name": span.name,
                    "span_type": str(span.span_type) if span.span_type else "UNKNOWN",
                    "duration_ms": span_duration_ms,
                    "start_offset_ms": start_offset_ms,
                    # .value, not str() — SpanStatusCode is an Enum whose default str()
                    # is "SpanStatusCode.OK", not "OK", which silently broke every
                    # downstream status comparison (both the raw trace view's error
                    # styling and the turn-timing succeeded/failed check) into always
                    # treating every span as non-OK regardless of its real status.
                    "status": span.status.status_code.value if span.status else "UNSET",
                    "inputs": str(span.inputs)[:2000] if span.inputs is not None else "",
                    "outputs": str(span.outputs)[:2000] if span.outputs is not None else "",
                })
            result["traces"].append(trace_info)

        return result
    except Exception as e:
        return {"error": str(e), "traces": []}

def summarize_turn_traces(conversation_id: str, env_name: str = "Local", turn_count: int = None) -> list[dict]:
    """Match each MLflow trace for this conversation to a DAS turn — DAS creates one
    trace per request, so ordering traces by timestamp lines them up with turns 1..N —
    and summarize which agents/tools ran in that turn and how long each took. Returns
    [] on any failure (no URI configured, unreachable, no traces yet): this is best-effort
    enrichment on top of a test run, never something that should fail the run itself."""
    try:
        data = get_traces_for_conversation(conversation_id, env_name)
    except Exception:
        return []
    if data.get("error") or not data.get("traces"):
        return []

    traces = sorted(data["traces"], key=lambda t: t.get("timestamp") or "0")
    if turn_count:
        traces = traces[:turn_count]

    out = []
    for i, trace in enumerate(traces):
        agent_calls = []
        for s in trace.get("spans", []):
            if (s.get("span_type") or "").upper() not in ("AGENT", "TOOL"):
                continue
            status = s.get("status") or "UNSET"
            outputs = s.get("outputs") or ""
            # "Succeeded" here means both: MLflow didn't record an error status, AND the
            # call actually produced output — a tool that returns cleanly but with an
            # empty result is still a failure from the test's point of view (that's the
            # whole point of this as a micro-eval: catch silent internal-tool failures).
            succeeded = status in ("OK", "UNSET") and bool(outputs.strip())
            agent_calls.append({
                "name": s.get("name"),
                "type": s.get("span_type"),
                "durationMs": s.get("duration_ms"),
                "depth": s.get("depth", 0),
                "status": status,
                "succeeded": succeeded,
                "inputs": s.get("inputs") or "",
                "outputs": outputs,
            })
        out.append({
            "turnNo": i + 1,
            "traceId": trace.get("trace_id"),
            "responseTimeMs": trace.get("total_duration_ms"),
            "agentCalls": agent_calls,
        })
    return out

def build_turn_traces(actual_turns: list[dict], mlflow_turns: list[dict]) -> list[dict]:
    """Pair up a run's (user, assistant) turns with MLflow's per-turn agent/tool
    summaries into the shape stored in turn_traces_json. Shared by the live run path
    (core/tester.py) and the backfill endpoint (re-deriving it later for an older run
    from its stored conversation_id)."""
    assistant_turns = [t for t in actual_turns if t.get("role") == "assistant"]
    user_turns = [t for t in actual_turns if t.get("role") == "user"]
    turn_traces = []
    for idx, assistant_turn in enumerate(assistant_turns):
        mlflow_data = mlflow_turns[idx] if idx < len(mlflow_turns) else {}
        turn_traces.append({
            "turnNo": idx + 1,
            "userInput": user_turns[idx]["content"] if idx < len(user_turns) else "",
            "agentResponse": assistant_turn.get("content", ""),
            "responseTimeMs": assistant_turn.get("latencyMs"),
            "traceId": mlflow_data.get("traceId"),
            "agentCalls": mlflow_data.get("agentCalls", []),
        })
    return turn_traces
