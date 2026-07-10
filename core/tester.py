import json
import uuid
import asyncio
from datetime import datetime
from agents import Runner

from .config import MAX_TURNS, DEFAULT_EMAIL, DEFAULT_INDUSTRY
from .das_client import das_send, das_end
from .evaluator import evaluate_grades, evaluate_assumptions
from core.evaluator import evaluate_grades_string_match, evaluate_ctq_assumptions
from core.loader import extract_app_name

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

async def simulate_user_reply(simulator_agent, reference: dict, live_turns: list[dict], latest_agent_msg: str) -> str:
    prompt = build_user_prompt(reference, live_turns, latest_agent_msg)
    result = await Runner.run(simulator_agent, input=prompt)
    text = result.final_output
    return text.strip() if text else "I don't have that information."

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
    on_progress = None
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
    
    try:
        reqs = extract_requirements(reference)
        user_input = reqs[0] if reqs else "hello"
        
        for turn_no in range(1, MAX_TURNS + 1):
            if on_progress:
                on_progress("turn_start", {"conv_no": conv_no, "turn": turn_no, "user_input": user_input})
                
            actual_turns.append({"role": "user", "content": user_input})
            
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
                
            agent_msg = resp.get("agentResponse", "")
            actual_turns.append({"role": "assistant", "content": agent_msg})
            
            if on_progress:
                on_progress("agent_reply", {"conv_no": conv_no, "turn": turn_no, "agent_msg": agent_msg})
            
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
                user_input = await simulate_user_reply(simulator_agent, reference, actual_turns, agent_msg)
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
        
    grade_eval = await evaluate_grades(grade_evaluator_agent, suggested_grades, expected_grades, use_llm=use_llm_eval)
    
    assumption_text = "\n".join([t["assumptionText"] for t in assumption_turns])
    if assumption_text and expected_ctqs:
        assumption_eval = await evaluate_assumptions(assumption_evaluator_agent, app_name, assumption_text, expected_ctqs, use_llm=use_llm_eval)
    else:
        assumption_eval = {}
        
    if on_progress:
        on_progress("completed", {
            "conv_no": conv_no,
            "application": app_name,
            "conv_file": reference.get("filename", ""),
            "success": success,
            "error": error_msg,
            "flow_completed": flow_completed,
            "grades_passed": grade_eval.get("passed"),
            "assumptions_score": assumption_eval.get("overallScore"),
            "expected_grades": expected_grades,
            "suggested_grades": [g.get("gradeName", str(g)) if isinstance(g, dict) else str(g) for g in suggested_grades],
            "grades_matched_count": grade_eval.get("totalMatched", 0),
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
        "referenceTurns": reference.get("turns", [])
    }
