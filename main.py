import asyncio
import json
from datetime import datetime
from pathlib import Path
from core.config import CONVERSATION_FOLDER, DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE, DAS_ENVIRONMENTS, DAS_API_KEYS, MAX_PARALLEL_CONVERSATIONS
from core.loader import collect_test_files, extract_conversation_no, load_conversation_json, load_all_ground_truth
from core.tester import run_test
from core.reporter import generate_report
from core.db import (create_batch_run, update_batch_run_metrics, insert_test_result,
                     update_batch_run_notes, get_single_result_detail, update_test_result_full)
from test_agents import simulator_agent, grade_evaluator_agent, assumption_evaluator_agent

async def run_single_test_async(conv_file: Path, num_rounds: int, use_llm_eval: bool, das_env: str, on_progress=None, cancel_flag=None):
    api_url = DAS_ENVIRONMENTS.get(das_env, DAS_ENVIRONMENTS["Local"])
    api_key = DAS_API_KEYS.get(das_env, "")
    
    batch_id = create_batch_run(das_env, num_rounds)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = Path(f"results/session_{batch_id}_{datetime.now().strftime('%Y-%m-%d')}_single_{conv_file.stem}_{timestamp}")
    out_dir.mkdir(parents=True, exist_ok=True)
    
    gt = load_all_ground_truth(DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE)
    conv_no = extract_conversation_no(conv_file.name)
    reference = load_conversation_json(conv_file)
    reference["filename"] = conv_file.name
    expected_grades = gt["grades"].get(conv_no, {}).get("expectedGrades", [])
    expected_ctqs = gt["assumptions"].get(conv_no, {}).get("expectedCTQs", [])
    all_results = []
    
    for rnd in range(1, num_rounds + 1):
        if cancel_flag and cancel_flag.is_set():
            if on_progress:
                on_progress("cancelled", {"completed": rnd - 1, "total": num_rounds, "round": rnd})
            break
        if on_progress:
            on_progress("round_start", {"round": rnd, "total_rounds": num_rounds})
            on_progress("file_start", {"conv_no": conv_no, "conv_file": conv_file.name, "index": 1, "total": 1})

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
            on_progress=on_progress,
            das_env=das_env,
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
            agent_assumptions=result.get("agentAssumptionOutput", ""),
            actual_turns_json=json.dumps(result.get("actualTurns", [])),
            grade_eval_details=json.dumps(result.get("gradeEvaluation", {})),
            assumption_eval_details=json.dumps(result.get("assumptionEvaluation", {})),
            turn_traces_json=json.dumps(result.get("turnTraces", [])),
            total_duration_ms=result.get("timing", {}).get("totalDurationMs"),
            avg_turn_latency_ms=result.get("timing", {}).get("avgTurnLatencyMs"),
            grade_eval_ms=result.get("timing", {}).get("gradeEvalMs"),
            assumption_eval_ms=result.get("timing", {}).get("assumptionEvalMs"),
            simulator_tokens=result.get("usage", {}).get("simulatorTokens"),
            grade_eval_tokens=result.get("usage", {}).get("gradeEvalTokens"),
            assumption_eval_tokens=result.get("usage", {}).get("assumptionEvalTokens"),
            total_tokens=result.get("usage", {}).get("totalTokens"),
        )
            
        all_results.append(result)
        
    update_batch_run_metrics(batch_id)
    generate_report(out_dir, out_dir / "consolidated_report.xlsx")
    return out_dir

async def retry_single_result_async(result_id: int, use_llm_eval: bool = True, on_progress=None, cancel_flag=None):
    """Re-run the exact conversation+environment behind one stored result, and
    overwrite that same row with the fresh outcome — unlike the batch-level 'retry
    failed' (which spins up a whole new linked session), this updates the one result
    you're looking at in place, since that's what retrying a single conversation from
    its own detail view should mean."""
    existing = get_single_result_detail(result_id)
    if not existing:
        raise ValueError(f"No stored result found for id {result_id}")

    conv_no = existing["conversation_no"]
    das_env = existing["das_env"] or "Local"
    api_url = DAS_ENVIRONMENTS.get(das_env, DAS_ENVIRONMENTS["Local"])
    api_key = DAS_API_KEYS.get(das_env, "")

    conv_file = next((f for f in collect_test_files(CONVERSATION_FOLDER) if extract_conversation_no(f.name) == conv_no), None)
    if conv_file is None:
        raise ValueError(f"Conversation #{conv_no} not found in {CONVERSATION_FOLDER} — can't retry")

    gt = load_all_ground_truth(DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE)
    reference = load_conversation_json(conv_file)
    reference["filename"] = conv_file.name
    expected_grades = gt["grades"].get(conv_no, {}).get("expectedGrades", [])
    expected_ctqs = gt["assumptions"].get(conv_no, {}).get("expectedCTQs", [])

    if on_progress:
        on_progress("round_start", {"round": existing["round_no"] or 1, "total_rounds": 1})
        on_progress("file_start", {"conv_no": conv_no, "conv_file": conv_file.name, "index": 1, "total": 1})

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
        on_progress=on_progress,
        das_env=das_env,
    )

    g_eval = result.get("gradeEvaluation", {})
    a_eval = result.get("assumptionEvaluation", {})
    update_test_result_full(
        result_id,
        conversation_id=result.get("conversationId", ""),
        conversation_no=result.get("conversationNo", conv_no),
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
        agent_assumptions=result.get("agentAssumptionOutput", ""),
        actual_turns_json=json.dumps(result.get("actualTurns", [])),
        grade_eval_details=json.dumps(result.get("gradeEvaluation", {})),
        assumption_eval_details=json.dumps(result.get("assumptionEvaluation", {})),
        turn_traces_json=json.dumps(result.get("turnTraces", [])),
        total_duration_ms=result.get("timing", {}).get("totalDurationMs"),
        avg_turn_latency_ms=result.get("timing", {}).get("avgTurnLatencyMs"),
        grade_eval_ms=result.get("timing", {}).get("gradeEvalMs"),
        assumption_eval_ms=result.get("timing", {}).get("assumptionEvalMs"),
        simulator_tokens=result.get("usage", {}).get("simulatorTokens"),
        grade_eval_tokens=result.get("usage", {}).get("gradeEvalTokens"),
        assumption_eval_tokens=result.get("usage", {}).get("assumptionEvalTokens"),
        total_tokens=result.get("usage", {}).get("totalTokens"),
    )

    if existing.get("batch_id"):
        update_batch_run_metrics(existing["batch_id"])

    # run_test() above already emits its own "completed" progress event — an extra
    # one here would double-fire the frontend's completion toast/handler.
    return result_id

async def run_all_tests_async(num_rounds: int, use_llm_eval: bool, das_env: str, on_progress=None, cancel_flag=None, execution_mode: str = "sequential", conv_no_filter: list[int] = None, notes: str = None):
    api_url = DAS_ENVIRONMENTS.get(das_env, DAS_ENVIRONMENTS["Local"])
    api_key = DAS_API_KEYS.get(das_env, "")

    batch_id = create_batch_run(das_env, num_rounds)
    if notes:
        update_batch_run_notes(batch_id, notes)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = Path(f"results/session_{batch_id}_{datetime.now().strftime('%Y-%m-%d')}_full_run_{timestamp}")
    out_dir.mkdir(parents=True, exist_ok=True)

    gt = load_all_ground_truth(DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE)
    test_files = collect_test_files(CONVERSATION_FOLDER)
    if conv_no_filter:
        test_files = [f for f in test_files if extract_conversation_no(f.name) in conv_no_filter]
    parallel = execution_mode == "parallel"

    async def process_conversation(idx, conv_file, round_dir, rnd):
        conv_no = extract_conversation_no(conv_file.name)
        if not conv_no:
            return

        reference = load_conversation_json(conv_file)
        reference["filename"] = conv_file.name
        expected_grades = gt["grades"].get(conv_no, {}).get("expectedGrades", [])
        expected_ctqs = gt["assumptions"].get(conv_no, {}).get("expectedCTQs", [])

        if on_progress:
            on_progress("file_start", {"conv_no": conv_no, "conv_file": conv_file.name, "index": idx + 1, "total": len(test_files)})

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
            on_progress=on_progress,
            das_env=das_env,
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
            agent_assumptions=result.get("agentAssumptionOutput", ""),
            actual_turns_json=json.dumps(result.get("actualTurns", [])),
            grade_eval_details=json.dumps(result.get("gradeEvaluation", {})),
            assumption_eval_details=json.dumps(result.get("assumptionEvaluation", {})),
            turn_traces_json=json.dumps(result.get("turnTraces", [])),
            total_duration_ms=result.get("timing", {}).get("totalDurationMs"),
            avg_turn_latency_ms=result.get("timing", {}).get("avgTurnLatencyMs"),
            grade_eval_ms=result.get("timing", {}).get("gradeEvalMs"),
            assumption_eval_ms=result.get("timing", {}).get("assumptionEvalMs"),
            simulator_tokens=result.get("usage", {}).get("simulatorTokens"),
            grade_eval_tokens=result.get("usage", {}).get("gradeEvalTokens"),
            assumption_eval_tokens=result.get("usage", {}).get("assumptionEvalTokens"),
            total_tokens=result.get("usage", {}).get("totalTokens"),
        )

    cancelled = False
    for rnd in range(1, num_rounds + 1):
        if cancelled:
            break
        if on_progress:
            on_progress("round_start", {"round": rnd, "total_rounds": num_rounds, "total_files": len(test_files), "execution_mode": execution_mode})

        round_dir = out_dir / f"round{rnd}"
        round_dir.mkdir(exist_ok=True)

        if parallel:
            semaphore = asyncio.Semaphore(MAX_PARALLEL_CONVERSATIONS)
            completed_count = 0

            async def guarded(idx, conv_file):
                nonlocal completed_count
                async with semaphore:
                    if cancel_flag and cancel_flag.is_set():
                        return
                    await process_conversation(idx, conv_file, round_dir, rnd)
                    completed_count += 1

            await asyncio.gather(*[guarded(idx, cf) for idx, cf in enumerate(test_files)])

            if cancel_flag and cancel_flag.is_set():
                cancelled = True
                if on_progress:
                    on_progress("cancelled", {"completed": completed_count, "total": len(test_files), "round": rnd})
        else:
            for idx, conv_file in enumerate(test_files):
                if cancel_flag and cancel_flag.is_set():
                    cancelled = True
                    if on_progress:
                        on_progress("cancelled", {"completed": idx, "total": len(test_files), "round": rnd})
                    break
                await process_conversation(idx, conv_file, round_dir, rnd)

    update_batch_run_metrics(batch_id)

    generate_report(out_dir, out_dir / "consolidated_report.xlsx")
    return out_dir

def list_available_conversations():
    files = collect_test_files(CONVERSATION_FOLDER)
    return [f.name for f in files]
