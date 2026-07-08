import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from pathlib import Path
import json

# --- Styles ---
GREEN      = PatternFill("solid", fgColor="C6EFCE")
YELLOW     = PatternFill("solid", fgColor="FFEB9C")
RED        = PatternFill("solid", fgColor="FFC7CE")
BLUE_HDR   = PatternFill("solid", fgColor="1F4E79")
PURPLE_HDR = PatternFill("solid", fgColor="4E1F79")
GREY_HDR   = PatternFill("solid", fgColor="D9D9D9")
ALT_ROW    = PatternFill("solid", fgColor="EBF3FB")
WHITE_BOLD = Font(bold=True, color="FFFFFF", name="Arial", size=10)
BLACK_BOLD = Font(bold=True, name="Arial", size=10)
CELL_FONT  = Font(name="Arial", size=10)
WRAP       = Alignment(wrap_text=True, vertical="top")
CENTRE     = Alignment(horizontal="center", vertical="top", wrap_text=True)
THIN       = Border(left=Side("thin"), right=Side("thin"), top=Side("thin"), bottom=Side("thin"))

GRADES_HEADERS = ["No.", "Application", "Expected Grades", "Suggested Grades", "Matched Grades",
                  "Total Suggested", "Total Expected", "Total Matched", "Grade Pass", "Flow Completed", "Error"]
GRADES_WIDTHS = [6, 22, 38, 38, 30, 14, 13, 13, 11, 14, 30]

ASSUMPTION_HEADERS = ["No.", "Application", "Pass/Fail", "Score /10", "Matched", "Total Exp",
                      "Expected CTQs", "Agent Assumption Output", "Matched CTQs", "Unmatched CTQs",
                      "Extra CTQs", "Match Details (Evidence)", "Unmatched Reasons", "Method", "Reasoning"]
ASSUMPTION_WIDTHS = [5, 28, 10, 10, 9, 9, 38, 55, 38, 35, 38, 55, 45, 12, 55]

def _pass_fill(passed: bool | None) -> PatternFill:
    if passed is None: return PatternFill(fill_type=None)
    return GREEN if passed else RED

def _score_fill(score: float | None) -> PatternFill:
    if score is None: return PatternFill(fill_type=None)
    if score >= 7.0: return GREEN
    if score >= 5.0: return YELLOW
    return RED

def _set_col_widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

def _hdr(ws, headers, row, fill):
    for i, h in enumerate(headers, 1):
        cell = ws.cell(row=row, column=i, value=h)
        cell.font = WHITE_BOLD
        cell.fill = fill
        cell.alignment = CENTRE
        cell.border = THIN

def _fmt_list(items):
    if not items: return ""
    return "\n".join(f"• {x}" for x in items)

def _fmt_match_details(details):
    if not details: return ""
    return "\n".join(f"• {d.get('expected', '')}: {d.get('actualEvidence', '')}" for d in details)

def _fmt_unmatched_reasons(reasons):
    if not reasons: return ""
    return "\n".join(f"• {r.get('expected', '')}: {r.get('reason', '')}" for r in reasons)

def build_grades_sheet(ws, results: list[dict]):
    _set_col_widths(ws, GRADES_WIDTHS)
    _hdr(ws, GRADES_HEADERS, 1, PURPLE_HDR)
    
    for r_idx, res in enumerate(results, 2):
        eval_data = res.get("gradeEvaluation", {})
        if not eval_data:
            eval_data = res.get("evaluation", {}) # Fallback for old format
            
        row_data = [
            res.get("conversationNo", ""),
            res.get("application", ""),
            _fmt_list(res.get("expectedGrades", [])),
            _fmt_list([g.get("gradeName", str(g)) if isinstance(g, dict) else str(g) for g in res.get("suggestedGrades", [])]),
            _fmt_list(eval_data.get("matchedSuggested", [])),
            eval_data.get("totalSuggested", 0),
            eval_data.get("totalExpected", 0),
            eval_data.get("totalMatched", 0),
            "PASS" if eval_data.get("passed") else ("FAIL" if eval_data.get("passed") is False else "N/A"),
            "Yes" if res.get("flowCompleted") else "No",
            res.get("error", "")
        ]
        
        for c_idx, val in enumerate(row_data, 1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = CELL_FONT
            cell.alignment = WRAP
            cell.border = THIN
            if c_idx % 2 == 0: cell.fill = ALT_ROW
            
            if GRADES_HEADERS[c_idx-1] == "Grade Pass":
                cell.fill = _pass_fill(eval_data.get("passed"))
            if GRADES_HEADERS[c_idx-1] == "Flow Completed":
                cell.fill = _pass_fill(res.get("flowCompleted"))

def build_assumption_sheet(ws, results: list[dict]):
    _set_col_widths(ws, ASSUMPTION_WIDTHS)
    _hdr(ws, ASSUMPTION_HEADERS, 1, BLUE_HDR)
    
    for r_idx, res in enumerate(results, 2):
        eval_data = res.get("assumptionEvaluation", {})
        if not eval_data:
            continue
            
        row_data = [
            res.get("conversationNo", ""),
            res.get("application", ""),
            "PASS" if eval_data.get("passed") else ("FAIL" if eval_data.get("passed") is False else "N/A"),
            eval_data.get("overallScore", ""),
            len(eval_data.get("matchedCTQs", [])),
            len(eval_data.get("matchedCTQs", [])) + len(eval_data.get("unmatchedCTQs", [])),
            _fmt_list([c.get("expected", "") for c in eval_data.get("matchedCTQs", [])] + [c.get("expected", "") for c in eval_data.get("unmatchedCTQs", [])]),
            res.get("agentAssumptionOutput", ""),
            _fmt_list([c.get("expected", "") for c in eval_data.get("matchedCTQs", [])]),
            _fmt_list([c.get("expected", "") for c in eval_data.get("unmatchedCTQs", [])]),
            _fmt_list(eval_data.get("extraCTQs", [])),
            _fmt_match_details(eval_data.get("matchedCTQs", [])),
            _fmt_unmatched_reasons(eval_data.get("unmatchedCTQs", [])),
            eval_data.get("method", ""),
            eval_data.get("reasoning", "")
        ]
        
        for c_idx, val in enumerate(row_data, 1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = CELL_FONT
            cell.alignment = WRAP
            cell.border = THIN
            if c_idx % 2 == 0: cell.fill = ALT_ROW
            
            if ASSUMPTION_HEADERS[c_idx-1] == "Pass/Fail":
                cell.fill = _pass_fill(eval_data.get("passed"))
            if ASSUMPTION_HEADERS[c_idx-1] == "Score /10":
                cell.fill = _score_fill(eval_data.get("overallScore"))

def generate_report(results_folder: str | Path, output_path: str | Path) -> Path:
    results_folder = Path(results_folder)
    output_path = Path(output_path)
    wb = Workbook()
    wb.remove(wb.active)
    
    rounds = sorted([d for d in results_folder.iterdir() if d.is_dir() and d.name.startswith("round")])
    if not rounds:
        rounds = [results_folder]
        
    for round_dir in rounds:
        round_name = round_dir.name if round_dir.name.startswith("round") else "round1"
        
        results = []
        for file_path in round_dir.glob("result_*.json"):
            with open(file_path, "r", encoding="utf-8") as f:
                results.append(json.load(f))
        
        if not results:
            continue
            
        results.sort(key=lambda x: x.get("conversationNo", 999))
        
        ws_grades = wb.create_sheet(title=f"Grades_{round_name}")
        build_grades_sheet(ws_grades, results)
        
        has_assumptions = any(r.get("assumptionEvaluation") for r in results)
        if has_assumptions:
            ws_assumptions = wb.create_sheet(title=f"Assumptions_{round_name}")
            build_assumption_sheet(ws_assumptions, results)
        
    if not wb.sheetnames:
        wb.create_sheet("Empty")
        
    wb.save(output_path)
    return output_path
