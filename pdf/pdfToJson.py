import os
import json
import re
from pypdf import PdfReader

INPUT_DIR = "./pdfs"       # put all PDFs here
OUTPUT_DIR = "./conv"  # JSON files will be written here

INDUSTRY = "Electrical & Electronics"
USER_EMAIL = "sanidhya.rana_contractor@celanese.com"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def extract_text_from_pdf(pdf_path):
    reader = PdfReader(pdf_path)
    pages = []
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            pages.append(page_text)
    return "\n".join(pages)


def extract_email(raw_text: str) -> str:
    """Extract user email from 'Chat Export for <email>' header line."""
    # Matches both 'Chat Export for:' and 'Chat Export for ' (no colon)
    m = re.search(r"Chat Export for\s*:?\s*([\w.+\-]+@[\w.\-]+)", raw_text)
    if m:
        return m.group(1).strip()
    return USER_EMAIL


def parse_turns(raw_text: str) -> list:
    """
    Splits on 'Assistant:' / 'User:' labels and returns structured turns.
    Preserves original wording exactly.
    """
    turns = []

    # Normalise line endings
    raw_text = raw_text.replace("\r", "")

    # Strip the header line so it doesn't bleed into the first turn
    raw_text = re.sub(r"Chat Export for[^\n]*\n?", "", raw_text, count=1)

    # Split on role labels — keep the delimiter so we know which role it is
    pattern = re.compile(r"(Assistant:|User:)")
    parts = pattern.split(raw_text)

    current_role = None
    current_content = []

    for part in parts:
        if part == "Assistant:":
            if current_role and current_content:
                turns.append({
                    "role": current_role,
                    "content": " ".join("".join(current_content).split()).strip()
                })
            current_role = "assistant"
            current_content = []
        elif part == "User:":
            if current_role and current_content:
                turns.append({
                    "role": current_role,
                    "content": " ".join("".join(current_content).split()).strip()
                })
            current_role = "user"
            current_content = []
        else:
            current_content.append(part)

    # Flush last turn
    if current_role and current_content:
        turns.append({
            "role": current_role,
            "content": " ".join("".join(current_content).split()).strip()
        })

    # Drop empty turns
    return [t for t in turns if t["content"]]


def convert_pdf_to_json(pdf_path):
    raw_text = extract_text_from_pdf(pdf_path)
    email = extract_email(raw_text)
    turns = parse_turns(raw_text)

    return {
        "industry": INDUSTRY,
        "user_email": email,
        "turns": turns
    }

for filename in os.listdir(INPUT_DIR):
    if filename.lower().endswith(".pdf"):
        pdf_path = os.path.join(INPUT_DIR, filename)
        json_data = convert_pdf_to_json(pdf_path)

        output_filename = filename.replace(".pdf", ".json")
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2, ensure_ascii=False)

        print(f"✅ Converted: {filename} → {output_filename}")