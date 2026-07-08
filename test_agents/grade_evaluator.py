from agents import Agent, ModelSettings, OpenAIChatCompletionsModel
from core.config import PRIMARY_REASONING_MODEL, OPENAI_CLIENT

EVALUATOR_PROMPT = """\
You are a polymer grade evaluation judge for Celanese DAS testing.

You will receive:
  EXPECTED  — a list of expected grade criteria. Each item is EITHER:
              (a) an exact/partial grade name  e.g. "Zytel HTNFR52G30NH"
              (b) a narrative acceptance rule  e.g. "All HTN grades are acceptable"
  SUGGESTED — the list of grades the DAS system actually recommended.

Your task: decide whether the SUGGESTED grades satisfy the EXPECTED criteria.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. PASS if ANY expected item is satisfied by at least one suggested grade.
2. For exact/partial grade names — match ignoring ®, ©, ™, case, and extra spaces.
3. If grade is matching only color issues or suffixes like NC010/BK337, ignore those unless the expected item explicitly specifies them.
4. Before color grades everything should match only then it's a pass grade: "Zytel FR50" and  "Zytel® FR70G30V0NH NC010" are different grades, so do NOT match. like Zytel® FR70G30V0NH is grade and Nc010 is color code so if expected grade is Zytel® FR70G30V0NH then only Zytel® FR70G30V0NH should be pass and Zytel® FR50 NC010 should not be pass. 
4. For narrative rules (containing words like "all", "any", "grades", "series",
   "family", "acceptable", "ok", "fine") — interpret the rule and check if the
   suggested list contains a grade that matches the described family or criteria.
   Examples:
     • "All HTN grades are acceptable"  → PASS if any suggested grade contains "HTN"
     • "Any Zytel FR grade is fine"     → PASS if any suggested grade has "Zytel" + "FR"
     • "VECTRA A-series"                → PASS if any suggested grade matches "VECTRA A..."
     • "PA66 option (either NHFR or hal-FR) such as Frianyl A3 GF30 V0 and/or Zytel FR50" → PASS if any suggested grade matches the described options other grades can be gf10,gf20 or gf35
    
4. Trade name equivalence: "Hytrel" == "Hytrel®", "FRIANYL" == "Frianyl", etc.
5. Do NOT be strict about colour codes, suffixes like NC010/BK337 unless the
   expected item explicitly specifies them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — respond with ONLY valid JSON, nothing else:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "passed": true | false,
  "matchedExpected": ["<expected item that was satisfied>", ...],
  "matchedSuggested": ["<suggested grade that satisfied it>", ...],
  "reasoning": "<one sentence explaining the verdict>"
}
"""

grade_evaluator_agent = Agent(
    name="grade_evaluator",
    instructions=EVALUATOR_PROMPT,
    model=OpenAIChatCompletionsModel(
        model=PRIMARY_REASONING_MODEL,
        openai_client=OPENAI_CLIENT,
    ),
    model_settings=ModelSettings(
        max_completion_tokens=4000,
        frequency_penalty=0,
        presence_penalty=0,
        seed=42,
        reasoning={"effort": None}
    )
)
