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
                    "status": str(span.status.status_code) if span.status else "UNSET",
                    "inputs": str(span.inputs)[:2000] if span.inputs is not None else "",
                    "outputs": str(span.outputs)[:2000] if span.outputs is not None else "",
                })
            result["traces"].append(trace_info)

        return result
    except Exception as e:
        return {"error": str(e), "traces": []}
