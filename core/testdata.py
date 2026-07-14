import io
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from core.config import CONVERSATION_FOLDER, DEFAULT_GRADES_FILE, DEFAULT_ASSUMPTIONS_FILE, DEFAULT_INDUSTRY, DEFAULT_EMAIL
from core.loader import collect_test_files, extract_conversation_no, extract_app_name, load_conversation_json

GROUND_TRUTH_DIR = Path(DEFAULT_GRADES_FILE).parent
BACKUP_DIR = GROUND_TRUTH_DIR / ".backups"

class ValidationError(Exception):
    pass

def _slugify(application: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", application).strip("_")
    return slug or "Untitled"

def _backup_file(path: Path):
    if not path.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.copy2(path, BACKUP_DIR / f"{path.name}.{timestamp}.bak")

def _load_json_array(path: str | Path) -> list:
    path = Path(path)
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def _save_json_array(path: str | Path, data: list):
    path = Path(path)
    _backup_file(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def validate_conversation_payload(payload: dict):
    application = (payload.get("application") or "").strip()
    if not application:
        raise ValidationError("Application name is required.")

    turns = payload.get("turns")
    if not isinstance(turns, list) or len(turns) == 0:
        raise ValidationError("At least one turn is required.")
    for i, t in enumerate(turns):
        if not isinstance(t, dict):
            raise ValidationError(f"Turn {i + 1} is not a valid object.")
        role = t.get("role")
        content = (t.get("content") or "").strip()
        if role not in ("user", "assistant"):
            raise ValidationError(f"Turn {i + 1} has an invalid role '{role}' (must be 'user' or 'assistant').")
        if not content:
            raise ValidationError(f"Turn {i + 1} has empty content.")

    expected_grades = payload.get("expectedGrades", [])
    if not isinstance(expected_grades, list) or any(not isinstance(g, str) for g in expected_grades):
        raise ValidationError("Expected grades must be a list of strings.")

    expected_ctqs = payload.get("expectedCTQs", [])
    if not isinstance(expected_ctqs, list) or any(not isinstance(c, str) for c in expected_ctqs):
        raise ValidationError("Expected CTQs must be a list of strings.")

def list_conversations_with_coverage() -> list[dict]:
    gt_grades = {item["conversationNo"]: item for item in _load_json_array(DEFAULT_GRADES_FILE)}
    gt_assumptions = {item["conversationNo"]: item for item in _load_json_array(DEFAULT_ASSUMPTIONS_FILE)}

    out = []
    for f in collect_test_files(CONVERSATION_FOLDER):
        conv_no = extract_conversation_no(f.name)
        if conv_no is None:
            continue
        try:
            data = load_conversation_json(f)
        except Exception:
            data = {}
        application = data.get("application", extract_app_name(f.name))
        turns = data.get("turns", [])
        grades_entry = gt_grades.get(conv_no)
        ctq_entry = gt_assumptions.get(conv_no)
        out.append({
            "conversationNo": conv_no,
            "filename": f.name,
            "application": application,
            "industry": data.get("industry", ""),
            "turnCount": len(turns),
            "hasExpectedGrades": bool(grades_entry and grades_entry.get("expectedGrades")),
            "hasExpectedCTQs": bool(ctq_entry and ctq_entry.get("expectedCTQs")),
        })
    out.sort(key=lambda x: x["conversationNo"])
    return out

def get_conversation_detail(conv_no: int) -> dict | None:
    for f in collect_test_files(CONVERSATION_FOLDER):
        if extract_conversation_no(f.name) == conv_no:
            data = load_conversation_json(f)
            gt_grades = {item["conversationNo"]: item for item in _load_json_array(DEFAULT_GRADES_FILE)}
            gt_assumptions = {item["conversationNo"]: item for item in _load_json_array(DEFAULT_ASSUMPTIONS_FILE)}
            grades_entry = gt_grades.get(conv_no, {})
            ctq_entry = gt_assumptions.get(conv_no, {})
            return {
                "conversationNo": conv_no,
                "filename": f.name,
                "application": data.get("application", extract_app_name(f.name)),
                "industry": data.get("industry", DEFAULT_INDUSTRY),
                "userEmail": data.get("user_email", DEFAULT_EMAIL),
                "turns": data.get("turns", []),
                "expectedGrades": grades_entry.get("expectedGrades", []),
                "expectedCTQs": ctq_entry.get("expectedCTQs", []),
            }
    return None

def _next_conversation_no() -> int:
    existing = [extract_conversation_no(f.name) for f in collect_test_files(CONVERSATION_FOLDER)]
    existing = [n for n in existing if n is not None]
    return (max(existing) + 1) if existing else 1

def create_conversation(payload: dict) -> dict:
    validate_conversation_payload(payload)

    conv_no = _next_conversation_no()
    application = payload["application"].strip()
    filename = f"Conversation_{conv_no}_{_slugify(application)}.json"
    conv_path = Path(CONVERSATION_FOLDER) / filename

    conv_json = {
        "application": application,
        "industry": (payload.get("industry") or DEFAULT_INDUSTRY).strip(),
        "user_email": (payload.get("userEmail") or DEFAULT_EMAIL).strip(),
        "turns": payload["turns"],
    }

    grades = _load_json_array(DEFAULT_GRADES_FILE)
    grades.append({
        "conversationNo": conv_no,
        "application": application,
        "expectedGrades": payload.get("expectedGrades", []),
    })

    ctqs = _load_json_array(DEFAULT_ASSUMPTIONS_FILE)
    ctqs.append({
        "conversationNo": conv_no,
        "application": application,
        "industry": conv_json["industry"],
        "expectedCTQs": payload.get("expectedCTQs", []),
    })

    # Write conversation file last, after ground truth writes succeed, so a
    # failure leaves no conversation file with unrecorded ground truth.
    _save_json_array(DEFAULT_GRADES_FILE, grades)
    _save_json_array(DEFAULT_ASSUMPTIONS_FILE, ctqs)
    with open(conv_path, "w", encoding="utf-8") as f:
        json.dump(conv_json, f, indent=2, ensure_ascii=False)

    return {"conversationNo": conv_no, "filename": filename}

def update_conversation(conv_no: int, payload: dict):
    validate_conversation_payload(payload)

    existing_file = None
    for f in collect_test_files(CONVERSATION_FOLDER):
        if extract_conversation_no(f.name) == conv_no:
            existing_file = f
            break
    if existing_file is None:
        raise ValidationError(f"Conversation {conv_no} not found.")

    application = payload["application"].strip()
    new_filename = f"Conversation_{conv_no}_{_slugify(application)}.json"
    new_path = Path(CONVERSATION_FOLDER) / new_filename

    conv_json = {
        "application": application,
        "industry": (payload.get("industry") or DEFAULT_INDUSTRY).strip(),
        "user_email": (payload.get("userEmail") or DEFAULT_EMAIL).strip(),
        "turns": payload["turns"],
    }

    grades = _load_json_array(DEFAULT_GRADES_FILE)
    grades = [g for g in grades if g.get("conversationNo") != conv_no]
    grades.append({"conversationNo": conv_no, "application": application, "expectedGrades": payload.get("expectedGrades", [])})

    ctqs = _load_json_array(DEFAULT_ASSUMPTIONS_FILE)
    ctqs = [c for c in ctqs if c.get("conversationNo") != conv_no]
    ctqs.append({
        "conversationNo": conv_no,
        "application": application,
        "industry": conv_json["industry"],
        "expectedCTQs": payload.get("expectedCTQs", []),
    })

    _save_json_array(DEFAULT_GRADES_FILE, grades)
    _save_json_array(DEFAULT_ASSUMPTIONS_FILE, ctqs)

    _backup_file(existing_file)
    if existing_file.resolve() != new_path.resolve():
        existing_file.unlink()
    with open(new_path, "w", encoding="utf-8") as f:
        json.dump(conv_json, f, indent=2, ensure_ascii=False)

def delete_conversation(conv_no: int):
    existing_file = None
    for f in collect_test_files(CONVERSATION_FOLDER):
        if extract_conversation_no(f.name) == conv_no:
            existing_file = f
            break

    grades = [g for g in _load_json_array(DEFAULT_GRADES_FILE) if g.get("conversationNo") != conv_no]
    ctqs = [c for c in _load_json_array(DEFAULT_ASSUMPTIONS_FILE) if c.get("conversationNo") != conv_no]
    _save_json_array(DEFAULT_GRADES_FILE, grades)
    _save_json_array(DEFAULT_ASSUMPTIONS_FILE, ctqs)

    if existing_file is not None:
        _backup_file(existing_file)
        existing_file.unlink()

def _app_name_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    match = re.search(r'Conversation_\d+_(.+)$', stem, re.IGNORECASE)
    name = match.group(1) if match else stem
    return re.sub(r'[_-]+', ' ', name).strip()

def _parse_json_upload(raw: bytes, filename: str) -> dict:
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise ValidationError(f"Invalid JSON file: {e}")
    if not isinstance(data, dict):
        raise ValidationError("JSON file must contain an object with a 'turns' array.")

    turns = data.get("turns")
    if not isinstance(turns, list) or not turns:
        raise ValidationError("JSON file has no 'turns' array.")

    parsed_turns = []
    for t in turns:
        if not isinstance(t, dict):
            continue
        role = t.get("role")
        content = (t.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            parsed_turns.append({"role": role, "content": content})
    if not parsed_turns:
        raise ValidationError("No valid turns (with role 'user'/'assistant' and content) found in JSON file.")

    return {
        "application": (data.get("application") or "").strip() or _app_name_from_filename(filename),
        "industry": data.get("industry", ""),
        "turns": parsed_turns,
    }

# Matches the "User: ..." / "Assistant: ..." line format produced by the DAS
# chat-export PDFs; everything up to the next such line belongs to that turn.
_PDF_TURN_RE = re.compile(r'^(User|Assistant):\s*(.*)$')

def _parse_pdf_upload(raw: bytes, filename: str) -> dict:
    import pdfplumber

    turns = []
    role = None
    buf = []

    def flush():
        if role is not None:
            content = " ".join(x for x in buf if x).strip()
            if content:
                turns.append({"role": role, "content": content})

    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                for line in text.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    m = _PDF_TURN_RE.match(line)
                    if m:
                        flush()
                        role = "user" if m.group(1) == "User" else "assistant"
                        buf = [m.group(2)]
                    elif role is not None:
                        buf.append(line)
            flush()
    except ValidationError:
        raise
    except Exception as e:
        raise ValidationError(f"Failed to parse PDF: {e}")

    if not turns:
        raise ValidationError("No conversation turns found in PDF (expected lines starting with 'User:' / 'Assistant:').")

    return {
        "application": _app_name_from_filename(filename),
        "industry": "",
        "turns": turns,
    }

def parse_conversation_upload(filename: str, raw: bytes) -> dict:
    """Parse an uploaded .json or .pdf file into {application, industry, turns}
    so the Add Conversation form can be pre-filled instead of entering turns one by one."""
    ext = Path(filename).suffix.lower()
    if ext == ".json":
        return _parse_json_upload(raw, filename)
    if ext == ".pdf":
        return _parse_pdf_upload(raw, filename)
    raise ValidationError("Unsupported file type. Upload a .json or .pdf file.")
