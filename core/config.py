import os
from dotenv import load_dotenv
from openai import AsyncAzureOpenAI

load_dotenv(override=False)

# Constants
MAX_TURNS = 20
DEFAULT_EMAIL = "Tester.Agent@celanese.com"
DEFAULT_INDUSTRY = "Electrical & Electronics"
MAX_PARALLEL_CONVERSATIONS = int(os.getenv("MAX_PARALLEL_CONVERSATIONS", "4"))

# File paths
DEFAULT_GRADES_FILE = "./groundTruth/expectedGrades.json"
DEFAULT_ASSUMPTIONS_FILE = "./groundTruth/groundTruthAssumption.json"
CONVERSATION_FOLDER = "./conversation"

# DAS API Environments
DAS_ENVIRONMENTS = {
    "Local": os.getenv("DAS_URL_LOCAL", "http://localhost:7071/api/das_agent"),
    "Dev": os.getenv("DAS_URL_DEV", ""),
    "Test": os.getenv("DAS_URL_TEST", ""),
    "QA": os.getenv("DAS_URL_QA", ""),
    "UAT": os.getenv("DAS_URL_UAT", ""),
    "Prod": os.getenv("DAS_URL_PROD", ""),
}

DAS_API_KEYS = {
    "Local": os.getenv("DAS_API_KEY_LOCAL", ""),
    "Dev": os.getenv("DAS_API_KEY_DEV", ""),
    "Test": os.getenv("DAS_API_KEY_TEST", ""),
    "QA": os.getenv("DAS_API_KEY_QA", ""),
    "UAT": os.getenv("DAS_API_KEY_UAT", ""),
    "Prod": os.getenv("DAS_API_KEY_PROD", ""),
}

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT") or os.getenv("azure_openai_endpoint", "")
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY") or os.getenv("azure_openai_key", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION") or os.getenv("azure_openai_api_version", "2025-03-01-preview")

PRIMARY_REASONING_MODEL = os.getenv("PRIMARY_REASONING_LLM_MODEL", "aif-gpt-5-4-das-d-ussc-01")
ASSUMPTION_EVAL_MODEL = os.getenv("AZURE_OPENAI_DEPLOYMENT", "aif-gpt-4-1-das-d-ussc-01")

OPENAI_CLIENT = AsyncAzureOpenAI(
    api_key=AZURE_OPENAI_KEY,
    api_version=AZURE_OPENAI_API_VERSION,
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
)
