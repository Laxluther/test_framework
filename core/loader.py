import json
import re
from pathlib import Path

def load_conversation_json(path: str | Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def extract_conversation_no(filename: str) -> int | None:
    match = re.search(r'Conversation_(\d+)', filename, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None

def collect_test_files(folder: str) -> list[Path]:
    folder_path = Path(folder)
    files = list(folder_path.glob("*.json"))
    # Natural sort: extract number from filename, sort numerically
    def sort_key(f):
        m = re.search(r'(\d+)', f.stem)
        return int(m.group(1)) if m else 0
    return sorted(files, key=sort_key)

def load_expected_grades(path: str) -> dict[int, dict]:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return {item["conversationNo"]: item for item in data}
    except Exception as e:
        print(f"Error reading expected grades from {path}: {e}")
        return {}

def load_ground_truth_assumptions(path: str) -> dict[int, dict]:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return {item["conversationNo"]: item for item in data}
    except Exception as e:
        print(f"Error reading ground truth assumptions from {path}: {e}")
        return {}

def load_all_ground_truth(grades_path: str, assumptions_path: str) -> dict:
    return {
        "grades": load_expected_grades(grades_path),
        "assumptions": load_ground_truth_assumptions(assumptions_path)
    }
