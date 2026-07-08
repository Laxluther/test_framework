import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from core.config import CONVERSATION_FOLDER, DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE, DAS_ENVIRONMENTS, DAS_API_KEYS
from core.loader import collect_test_files, extract_conversation_no, load_conversation_json, load_all_ground_truth
from core.tester import run_test
from core.reporter import generate_report
from core.db import create_batch_run, update_batch_run_metrics, insert_test_result
from test_agents import simulator_agent, grade_evaluator_agent, assumption_evaluator_agent

async def run_single_test_async(conv_file: Path, num_rounds: int, use_llm_eval: bool, das_env: str, on_progress=None):
    api_url = DAS_ENVIRONMENTS.get(das_env, DAS_ENVIRONMENTS["Local"])
    api_key = DAS_API_KEYS.get(das_env, "")
    
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = Path(f"results/{datetime.now().strftime('%Y-%m-%d')}_single_{conv_file.stem}_{timestamp}")
    out_dir.mkdir(parents=True, exist_ok=True)
    
    gt = load_all_ground_truth(DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE)
    conv_no = extract_conversation_no(conv_file.name)
    reference = load_conversation_json(conv_file)
    
    expected_grades = gt["grades"].get(conv_no, {}).get("expectedGrades", [])
    expected_ctqs = gt["assumptions"].get(conv_no, {}).get("expectedCTQs", [])
    
    all_results = []
    
    for rnd in range(1, num_rounds + 1):
        if on_progress:
            on_progress("round_start", {"round": rnd})
            
        round_dir = out_dir / f"round{rnd}"
        round_dir.mkdir(exist_ok=True)
        
        result = await run_test(
            conv_no=conv_no,
            reference=reference,
            expected_grades=expected_grades,
            expected_ctqs=expected_ctqs,
            simulator_agent=simulator_agent,
            grade_evaluator_agent=grade_evaluator_agent,
            assumption_evaluator_agent=assumption_evaluator_agent,
            api_url=api_url,
            api_key=api_key,
            use_llm_eval=use_llm_eval,
            on_progress=on_progress
        )
        
        
        result_file = round_dir / f"result_{conv_file.stem}.json"
        with open(result_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
            
        g_eval = result.get("gradeEvaluation", {})
        a_eval = result.get("assumptionEvaluation", {})
        
        insert_test_result(
            batch_id=None,
            das_env=das_env,
            round_no=rnd,
            conversation_id=result.get("conversationId", ""),
            conversation_no=result.get("conversationNo", 0),
            application_name=result.get("application", ""),
            expected_grades=result.get("expectedGrades", []),
            suggested_grades=[g.get("gradeName", str(g)) if isinstance(g, dict) else str(g) for g in result.get("suggestedGrades", [])],
            grades_matched_count=g_eval.get("totalMatched", 0),
            grades_passed=g_eval.get("passed"),
            assumptions_score=a_eval.get("overallScore"),
            assumptions_passed=a_eval.get("passed"),
            flow_completed=result.get("flowCompleted", False),
            error_message=result.get("error", ""),
            expected_assumptions=expected_ctqs,
            agent_assumptions=result.get("agentAssumptionOutput", "")
        )
            
        all_results.append(result)
        
    generate_report(out_dir, out_dir / "consolidated_report.xlsx")
    return out_dir

async def run_all_tests_async(num_rounds: int, use_llm_eval: bool, das_env: str, on_progress=None):
    api_url = DAS_ENVIRONMENTS.get(das_env, DAS_ENVIRONMENTS["Local"])
    api_key = DAS_API_KEYS.get(das_env, "")
    
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = Path(f"results/{datetime.now().strftime('%Y-%m-%d')}_full_run_{timestamp}")
    out_dir.mkdir(parents=True, exist_ok=True)
    
    gt = load_all_ground_truth(DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE)
    test_files = collect_test_files(CONVERSATION_FOLDER)
    
    batch_id = create_batch_run(das_env, num_rounds)
    
    for rnd in range(1, num_rounds + 1):
        if on_progress:
            on_progress("round_start", {"round": rnd, "total_files": len(test_files)})
            
        round_dir = out_dir / f"round{rnd}"
        round_dir.mkdir(exist_ok=True)
        
        for idx, conv_file in enumerate(test_files):
            conv_no = extract_conversation_no(conv_file.name)
            if not conv_no: continue
                
            reference = load_conversation_json(conv_file)
            expected_grades = gt["grades"].get(conv_no, {}).get("expectedGrades", [])
            expected_ctqs = gt["assumptions"].get(conv_no, {}).get("expectedCTQs", [])
            
            if on_progress:
                on_progress("file_start", {"conv_file": conv_file.name, "index": idx + 1, "total": len(test_files)})
            
            result = await run_test(
                conv_no=conv_no,
                reference=reference,
                expected_grades=expected_grades,
                expected_ctqs=expected_ctqs,
                simulator_agent=simulator_agent,
                grade_evaluator_agent=grade_evaluator_agent,
                assumption_evaluator_agent=assumption_evaluator_agent,
                api_url=api_url,
                api_key=api_key,
                use_llm_eval=use_llm_eval,
                on_progress=on_progress
            )
            
            result_file = round_dir / f"result_{conv_file.stem}.json"
            with open(result_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
                
            g_eval = result.get("gradeEvaluation", {})
            a_eval = result.get("assumptionEvaluation", {})
            
            insert_test_result(
                batch_id=batch_id,
                das_env=das_env,
                round_no=rnd,
                conversation_id=result.get("conversationId", ""),
                conversation_no=result.get("conversationNo", 0),
                application_name=result.get("application", ""),
                expected_grades=result.get("expectedGrades", []),
                suggested_grades=[g.get("gradeName", str(g)) if isinstance(g, dict) else str(g) for g in result.get("suggestedGrades", [])],
                grades_matched_count=g_eval.get("totalMatched", 0),
                grades_passed=g_eval.get("passed"),
                assumptions_score=a_eval.get("overallScore"),
                assumptions_passed=a_eval.get("passed"),
                flow_completed=result.get("flowCompleted", False),
                error_message=result.get("error", ""),
                expected_assumptions=expected_ctqs,
                agent_assumptions=result.get("agentAssumptionOutput", "")
            )
            
    update_batch_run_metrics(batch_id)
                
    generate_report(out_dir, out_dir / "consolidated_report.xlsx")
    return out_dir

def list_available_conversations():
    files = collect_test_files(CONVERSATION_FOLDER)
    return [f.name for f in files]

def list_past_runs():
    results_dir = Path("results")
    if not results_dir.exists():
        return []
    
    runs = []
    for d in sorted(results_dir.iterdir(), key=os.path.getmtime, reverse=True):
        if d.is_dir() and "round1" in [child.name for child in d.iterdir()]:
            runs.append(d.name)
    return runs
