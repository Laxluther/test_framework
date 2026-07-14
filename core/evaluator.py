import json
import re
from agents import Runner

def _run_tokens(result) -> int:
    """Total tokens (input+output) an agents-SDK Runner.run() call consumed."""
    usage = getattr(getattr(result, "context_wrapper", None), "usage", None)
    return usage.total_tokens if usage else 0

# --- Grade Evaluation ---

def extract_grade_name(grade) -> str:
    if isinstance(grade, dict):
        return grade.get("grade_name") or grade.get("gradeName") or str(grade)
    return str(grade)

def normalise_grade(grade: str) -> str:
    return grade.lower().replace("®", "").replace("©", "").replace("™", "").replace("  ", " ").strip()

def evaluate_grades_string_match(suggested_grades: list, expected_grades: list) -> dict:
    if not expected_grades:
        return {
            "passed": None, "matchedExpected": [], "matchedSuggested": [],
            "totalSuggested": len(suggested_grades), "totalExpected": 0,
            "totalMatched": 0, "method": "string_match",
            "reasoning": None
        }

    suggested_names = [extract_grade_name(g) for g in suggested_grades]
    norm_expected = [normalise_grade(g) for g in expected_grades]
    norm_suggested = [normalise_grade(g) for g in suggested_names]

    matched_expected = []
    matched_suggested = []

    for exp, exp_norm in zip(expected_grades, norm_expected):
        for sug_name, sug_norm in zip(suggested_names, norm_suggested):
            if exp_norm in sug_norm or sug_norm in exp_norm:
                if exp not in matched_expected:
                    matched_expected.append(exp)
                if sug_name not in matched_suggested:
                    matched_suggested.append(sug_name)

    return {
        "passed": len(matched_expected) > 0,
        "matchedExpected": matched_expected,
        "matchedSuggested": matched_suggested,
        "totalSuggested": len(suggested_grades),
        "totalExpected": len(expected_grades),
        "totalMatched": len(matched_expected),
        "method": "string_match",
        "reasoning": None,
    }

def _is_narrative_expectation(items: list[str]) -> bool:
    narrative_keywords = {"all", "any", "acceptable", "ok", "fine", "series",
                          "family", "grades", "grade", "allowed", "accepted"}
    for item in items:
        words = set(item.lower().split())
        if words & narrative_keywords:
            return True
    return False

async def evaluate_grades_llm(evaluator_agent, suggested_grades: list, expected_grades: list) -> dict:
    suggested_names = [extract_grade_name(g) for g in suggested_grades]
    prompt = (
        f"EXPECTED:\n"
        + "\n".join(f"  - {e}" for e in expected_grades)
        + f"\n\nSUGGESTED:\n"
        + "\n".join(f"  - {s}" for s in suggested_names)
        + "\n\nEvaluate and respond with JSON only."
    )

    tokens = 0
    try:
        result = await Runner.run(evaluator_agent, input=prompt)
        tokens = _run_tokens(result)
        raw = result.final_output.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        parsed = json.loads(raw)

        matched_exp = parsed.get("matchedExpected", [])
        matched_sug = parsed.get("matchedSuggested", [])
        return {
            "passed": bool(parsed.get("passed", False)),
            "matchedExpected": matched_exp,
            "matchedSuggested": matched_sug,
            "totalSuggested": len(suggested_names),
            "totalExpected": len(expected_grades),
            "totalMatched": len(matched_exp),
            "method": "llm",
            "reasoning": parsed.get("reasoning", ""),
            "tokens": tokens,
        }
    except Exception as e:
        fallback = evaluate_grades_string_match(suggested_grades, expected_grades)
        fallback["method"] = "llm_fallback_string_match"
        fallback["reasoning"] = f"LLM evaluation failed ({e}), used string match"
        fallback["tokens"] = tokens
        return fallback

async def evaluate_grades(evaluator_agent, suggested_grades: list, expected_grades: list, use_llm: bool = True) -> dict:
    if not expected_grades:
        return {
            "passed": None, "matchedExpected": [], "matchedSuggested": [],
            "totalSuggested": len(suggested_grades), "totalExpected": 0,
            "totalMatched": 0, "method": "skipped", "reasoning": None,
        }

    string_result = evaluate_grades_string_match(suggested_grades, expected_grades)
    has_narrative = _is_narrative_expectation(expected_grades)

    if not use_llm or (string_result["passed"] and not has_narrative):
        return string_result

    llm_result = await evaluate_grades_llm(evaluator_agent, suggested_grades, expected_grades)
    
    if llm_result["passed"]:
        return llm_result
    
    if string_result["passed"]:
        merged_expected = list(set(llm_result["matchedExpected"] + string_result["matchedExpected"]))
        merged_suggested = list(set(llm_result["matchedSuggested"] + string_result["matchedSuggested"]))
        return {
            "passed": True,
            "matchedExpected": merged_expected,
            "matchedSuggested": merged_suggested,
            "totalSuggested": len(suggested_grades),
            "totalExpected": len(expected_grades),
            "totalMatched": len(merged_expected),
            "method": "string_match+llm",
            "reasoning": llm_result.get("reasoning", "")
        }
        
    return llm_result

# --- Assumption Evaluation ---

def _tokens(text: str) -> set[str]:
    stop_words = {"and", "or", "of", "with", "for", "to", "at", "a", "the", "in", "is", "up"}
    words = re.findall(r'[a-zA-Z0-9]+', text.lower())
    return {w for w in words if w not in stop_words}

def evaluate_assumptions_keyword_match(assumption_text: str, expected_ctqs: list[str]) -> dict:
    if not expected_ctqs:
        return {"passed": True, "matchedCTQs": [], "unmatchedCTQs": [], "extraCTQs": [], "overallScore": 10.0, "reasoning": "No CTQs expected", "method": "keyword_skipped"}
    
    matched = []
    unmatched = []
    text_tokens = _tokens(assumption_text)
    
    for ctq in expected_ctqs:
        ctq_tokens = _tokens(ctq)
        if not ctq_tokens:
            unmatched.append({"expected": ctq, "reason": "Empty CTQ"})
            continue
            
        overlap = ctq_tokens.intersection(text_tokens)
        score = len(overlap) / len(ctq_tokens)
        
        if score >= 0.5:
            matched.append({
                "expected": ctq,
                "actualEvidence": f"Keyword overlap: {score:.0%}",
                "matchNotes": "Keyword fallback match"
            })
        else:
            unmatched.append({
                "expected": ctq,
                "reason": f"Only {score:.0%} keyword overlap"
            })
            
    score = (len(matched) / len(expected_ctqs)) * 10
    return {
        "passed": score >= 5.0,
        "matchedCTQs": matched,
        "unmatchedCTQs": unmatched,
        "extraCTQs": [],
        "overallScore": round(score, 1),
        "reasoning": f"Keyword overlap matched {len(matched)}/{len(expected_ctqs)}",
        "method": "keyword_match"
    }

async def evaluate_assumptions_llm(evaluator_agent, application: str, assumption_text: str, expected_ctqs: list[str]) -> dict:
    prompt = (
        f"APPLICATION:\n{application}\n\n"
        f"EXPECTED_CTQS:\n{json.dumps(expected_ctqs, indent=2)}\n\n"
        f"ASSUMPTION_TEXT:\n{assumption_text}\n"
    )
    
    tokens = 0
    try:
        result = await Runner.run(evaluator_agent, input=prompt)
        tokens = _run_tokens(result)
        raw = result.final_output.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        parsed = json.loads(raw)
        parsed["method"] = "llm"
        parsed["tokens"] = tokens

        matched = parsed.get("matchedCTQs", [])
        expected_len = len(expected_ctqs)
        if "overallScore" not in parsed:
            score = (len(matched) / expected_len) * 10 if expected_len > 0 else 10.0
            parsed["overallScore"] = round(score, 1)
        if "passed" not in parsed:
            parsed["passed"] = parsed["overallScore"] >= 5.0

        return parsed
    except Exception as e:
        fallback = evaluate_assumptions_keyword_match(assumption_text, expected_ctqs)
        fallback["method"] = "llm_fallback_keyword"
        fallback["reasoning"] = f"LLM evaluation failed ({e}), used keyword match"
        fallback["tokens"] = tokens
        return fallback

async def evaluate_assumptions(evaluator_agent, application: str, assumption_text: str, expected_ctqs: list[str], use_llm: bool = True) -> dict:
    if not expected_ctqs:
        return {
            "passed": None, "matchedCTQs": [], "unmatchedCTQs": [], "extraCTQs": [],
            "overallScore": None, "reasoning": "No CTQs expected", "method": "skipped"
        }
        
    if not use_llm:
        return evaluate_assumptions_keyword_match(assumption_text, expected_ctqs)
        
    return await evaluate_assumptions_llm(evaluator_agent, application, assumption_text, expected_ctqs)
