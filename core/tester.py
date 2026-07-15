import json
import time
import uuid
import asyncio
from datetime import datetime
from agents import Runner

from .config import MAX_TURNS, DEFAULT_EMAIL, DEFAULT_INDUSTRY
from .das_client import das_send, das_end
from .evaluator import evaluate_grades, evaluate_assumptions
from .mlflow_client import summarize_turn_traces, build_turn_traces
from core.loader import extract_app_name

# MLflow trace fetch/summarize is a network round-trip against a third-party tracking
# server; cap it so a slow/hanging MLflow instance can never stall a test run.
TURN_TRACE_FETCH_TIMEOUT_S = 25.0

def extract_requirements(reference: dict) -> list[str]:
    return [t["content"] for t in reference.get("turns", []) if t["role"] == "user"]

def build_user_prompt(reference: dict, live_turns: list[dict], latest_agent_msg: str) -> str:
    req_block = str(reference.get("turns", []))
    
    live_lines = []
    for t in live_turns:
        label = "User" if t["role"] == "user" else "Agent"
        live_lines.append(f"  {label}: {t['content']}")
    live_block = "\n".join(live_lines) if live_lines else "  (conversation not yet started)"
    
    return (
        f"EXTRACTED REQUIREMENTS (your only facts):\n{req_block}\n\n"
        f"LIVE CONVERSATION SO FAR:\n{live_block}\n\n"
        f"DAS AGENT'S LATEST MESSAGE:\n  {latest_agent_msg}\n\n"
        f"Reply as the user."
    )

def _run_tokens(result) -> int:
    """Total tokens (input+output) an agents-SDK Runner.run() call consumed."""
    usage = getattr(getattr(result, "context_wrapper", None), "usage", None)
    return usage.total_tokens if usage else 0

async def simulate_user_reply(simulator_agent, reference: dict, live_turns: list[dict], latest_agent_msg: str) -> tuple[str, int]:
    prompt = build_user_prompt(reference, live_turns, latest_agent_msg)
    result = await Runner.run(simulator_agent, input=prompt)
    text = result.final_output
    reply = text.strip() if text else "I don't have that information."
    return reply, _run_tokens(result)

async def run_test(
    conv_no: int,
    reference: dict,
    expected_grades: list,
    expected_ctqs: list,
    simulator_agent,
    grade_evaluator_agent,
    assumption_evaluator_agent,
    api_url: str,
    api_key: str,
    use_llm_eval: bool = True,
    on_progress = None,
    das_env: str = "Local",
) -> dict:
    filename = reference.get("filename", f"Conversation_{conv_no}.json")
    app_name = reference.get("application", extract_app_name(filename))
    industry = reference.get("industry", DEFAULT_INDUSTRY)
    user_email = reference.get("user_email", DEFAULT_EMAIL)
    conversation_id = str(uuid.uuid4())

    actual_turns = []
    assumption_turns = []
    suggested_grades = []
    flow_completed = False
    success = False
    error_msg = ""
    run_start = time.perf_counter()
    # Latency of the simulator call that produced the user_input about to be sent.
    # None for turn 1, whose opening line comes verbatim from the reference conversation.
    pending_user_latency_ms = None
    simulator_tokens_total = 0

    try:
        reqs = extract_requirements(reference)
        user_input = reqs[0] if reqs else "hello"

        for turn_no in range(1, MAX_TURNS + 1):
            if on_progress:
                on_progress("turn_start", {"conv_no": conv_no, "turn": turn_no, "user_input": user_input, "latency_ms": pending_user_latency_ms})

            actual_turns.append({"role": "user", "content": user_input, "latencyMs": pending_user_latency_ms})

            das_start = time.perf_counter()
            try:
                resp = await das_send(
                    user_input=user_input,
                    conversation_id=conversation_id,
                    user_email=user_email,
                    industry=industry,
                    is_new=(turn_no == 1),
                    api_url=api_url,
                    api_key=api_key
                )
            except Exception as e:
                error_msg = f"DAS API error: {e}"
                break
            das_latency_ms = round((time.perf_counter() - das_start) * 1000, 1)

            agent_msg = resp.get("agentResponse", "")
            actual_turns.append({"role": "assistant", "content": agent_msg, "latencyMs": das_latency_ms})

            if on_progress:
                on_progress("agent_reply", {"conv_no": conv_no, "turn": turn_no, "agent_msg": agent_msg, "latency_ms": das_latency_ms})

            if resp.get("isAssumptionResponse"):
                assumption_turns.append({
                    "turnNo": turn_no,
                    "assumptionText": agent_msg
                })

            if resp.get("isAgentFlowComplete"):
                flow_completed = True
                success = True
                suggested_grades = resp.get("suggestedGrades", [])
                break

            try:
                sim_start = time.perf_counter()
                user_input, sim_tokens = await simulate_user_reply(simulator_agent, reference, actual_turns, agent_msg)
                pending_user_latency_ms = round((time.perf_counter() - sim_start) * 1000, 1)
                simulator_tokens_total += sim_tokens
            except Exception as e:
                import traceback
                error_msg = f"Simulator agent error: {type(e).__name__}: {e}\n{traceback.format_exc()}"
                print("\n" + "="*60 + "\n" + error_msg + "\n" + "="*60)
                break

    except Exception as e:
        error_msg = str(e)
    finally:
        await das_end(conversation_id, user_email, industry, api_url, api_key)

    if on_progress:
        on_progress("evaluating", {"conv_no": conv_no})

    grade_eval_start = time.perf_counter()
    grade_eval = await evaluate_grades(grade_evaluator_agent, suggested_grades, expected_grades, use_llm=use_llm_eval)
    grade_eval_ms = round((time.perf_counter() - grade_eval_start) * 1000, 1)

    grade_passed = grade_eval.get("passed")
    # When there are no expected grades to check (grade_passed is None), fall back
    # to flow completion rather than treating "nothing to grade" as a failure.
    success = flow_completed if grade_passed is None else grade_passed


    assumption_text = "\n".join([t["assumptionText"] for t in assumption_turns])
    assumption_eval_ms = None
    if assumption_text and expected_ctqs:
        assumption_eval_start = time.perf_counter()
        assumption_eval = await evaluate_assumptions(assumption_evaluator_agent, app_name, assumption_text, expected_ctqs, use_llm=use_llm_eval)
        assumption_eval_ms = round((time.perf_counter() - assumption_eval_start) * 1000, 1)
    else:
        assumption_eval = {}

    das_latencies = [t["latencyMs"] for t in actual_turns if t["role"] == "assistant" and t.get("latencyMs") is not None]
    avg_das_latency_ms = round(sum(das_latencies) / len(das_latencies), 1) if das_latencies else None
    total_duration_ms = round((time.perf_counter() - run_start) * 1000, 1)
    timing = {
        "totalDurationMs": total_duration_ms,
        "avgTurnLatencyMs": avg_das_latency_ms,
        "gradeEvalMs": grade_eval_ms,
        "assumptionEvalMs": assumption_eval_ms,
    }

    grade_eval_tokens = grade_eval.get("tokens", 0) or 0
    assumption_eval_tokens = assumption_eval.get("tokens", 0) or 0
    usage = {
        "simulatorTokens": simulator_tokens_total,
        "gradeEvalTokens": grade_eval_tokens,
        "assumptionEvalTokens": assumption_eval_tokens,
        "totalTokens": simulator_tokens_total + grade_eval_tokens + assumption_eval_tokens,
    }

    # Enrich each turn with which agents/tools MLflow recorded for it and how long
    # each took. Best-effort: an unconfigured/unreachable MLflow, or a timeout, just
    # means agentCalls stays empty — the turn's own responseTimeMs (measured locally
    # above, independent of MLflow) is unaffected either way.
    assistant_turn_count = sum(1 for t in actual_turns if t["role"] == "assistant")
    mlflow_turns = []
    if assistant_turn_count:
        try:
            mlflow_turns = await asyncio.wait_for(
                asyncio.to_thread(summarize_turn_traces, conversation_id, das_env, assistant_turn_count),
                timeout=TURN_TRACE_FETCH_TIMEOUT_S
            )
        except Exception:
            mlflow_turns = []
    turn_traces = build_turn_traces(actual_turns, mlflow_turns)

    if on_progress:
        on_progress("completed", {
            "conv_no": conv_no,
            "application": app_name,
            "conv_file": reference.get("filename", ""),
            "conversation_id": conversation_id,
            "success": success,
            "error": error_msg,
            "flow_completed": flow_completed,
            "grades_passed": grade_eval.get("passed"),
            "assumptions_score": assumption_eval.get("overallScore"),
            "expected_grades": expected_grades,
            "suggested_grades": [g.get("gradeName", str(g)) if isinstance(g, dict) else str(g) for g in suggested_grades],
            "grades_matched_count": grade_eval.get("totalMatched", 0),
            "timing": timing,
            "usage": usage,
        })

    return {
        "conversationNo": conv_no,
        "application": app_name,
        "industry": industry,
        "conversationId": conversation_id,
        "flowCompleted": flow_completed,
        "success": success,
        "error": error_msg,
        "expectedGrades": expected_grades,
        "suggestedGrades": suggested_grades,
        "gradeEvaluation": grade_eval,
        "assumptionTurns": assumption_turns,
        "agentAssumptionOutput": assumption_text,
        "assumptionEvaluation": assumption_eval,
        "actualTurns": actual_turns,
        "turnTraces": turn_traces,
        "referenceTurns": reference.get("turns", []),
        "timing": timing,
        "usage": usage,
    }
