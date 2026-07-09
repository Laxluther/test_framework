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

def get_traces_for_conversation(conversation_id, env_name="Local"):
    """Fetch agent traces from MLflow for a DAS conversation.
    Experiment name format: DAS-{conversation_id}
    """
    uri = get_mlflow_uri_for_env(env_name)
    if not uri:
        return {"error": f"No MLflow tracking URI configured for environment '{env_name}' (or fallback)"}
    
    try:
        import mlflow
        mlflow.set_tracking_uri(uri)
        
        experiment_name = f"DAS-{conversation_id}"
        experiment = mlflow.get_experiment_by_name(experiment_name)
        if not experiment:
            return {"error": f"No experiment found: {experiment_name}", "traces": []}
        
        traces = mlflow.search_traces(experiment_ids=[experiment.experiment_id])
        
        result = {
            "experiment_name": experiment_name,
            "total_traces": len(traces),
            "traces": []
        }
        
        for trace in traces:
            trace_info = {
                "trace_id": str(trace.info.request_id),
                "timestamp": str(trace.info.timestamp_ms),
                "total_duration_ms": trace.info.execution_time_ms,
                "status": str(trace.info.status),
                "spans": []
            }
            if hasattr(trace, 'data') and hasattr(trace.data, 'spans'):
                for span in trace.data.spans:
                    duration_ms = 0
                    if hasattr(span, 'end_time_ns') and hasattr(span, 'start_time_ns'):
                        duration_ms = round((span.end_time_ns - span.start_time_ns) / 1e6, 2)
                    trace_info["spans"].append({
                        "name": span.name,
                        "duration_ms": duration_ms,
                        "status": str(getattr(span, 'status', '')),
                        "inputs": str(getattr(span, 'inputs', ''))[:500],
                        "outputs": str(getattr(span, 'outputs', ''))[:500],
                    })
            result["traces"].append(trace_info)
        
        return result
    except Exception as e:
        return {"error": str(e), "traces": []}
