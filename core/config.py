import os
from dotenv import load_dotenv
from openai import AsyncAzureOpenAI

load_dotenv(override=False)

# Constants
MAX_TURNS = 20
DEFAULT_EMAIL = "Tester.Agent@celanese.com"
DEFAULT_INDUSTRY = "Electrical & Electronics"

# File paths
DEFAULT_GRADES_FILE = "./groundTruth/expectedGrades.json"
DEFAULT_ASSUMPTIONS_FILE = "./groundTruth/groundTruthAssumption.json"
CONVERSATION_FOLDER = "./conversation"

# DAS API Environments
DAS_ENVIRONMENTS = {
    "Local": "http://localhost:7071/api/das_agent",
    "Dev": "https://apim-gst-dev.azure-api.net/func-gstdas-v2-d-ussc-01/das_agent",
    "Test": "https://apim-gst-tst.azure-api.net/func-gstdas-v2-t-ussc-01/das_agent",
    "QA": "https://apim-gst-pfx.azure-api.net/func-gstdas-v2-qa-ussc-01/das_agent",
    "UAT": "https://apim-gst.azure-api.net/func-gstdas-v2-p-ussc-01/das_agent",
    "Prod": "https://apim-gst.azure-api.net/func-gstdas-v2-p-ussc-01/das_agent",
}

DAS_API_KEYS = {
    "Local": "",
    "Dev": os.getenv("DAS_API_KEY_DEV", "c2404e96bf0b471daf7f2b1091094fa1"),
    "Test": os.getenv("DAS_API_KEY_TEST", "3176b6e5d44c44e1be3459a8d896d9a8"),
    "QA": os.getenv("DAS_API_KEY_QA", "dea0e48055914945b8e810884cafc96a"),
    "UAT": os.getenv("DAS_API_KEY_UAT", "9ef12cd9fb244fc291d44dac1fa3a97e"),
    "Prod": os.getenv("DAS_API_KEY_PROD", ""),
}

# OpenAI Config
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT") or os.getenv("azure_openai_endpoint", "")
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY") or os.getenv("azure_openai_key", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION") or os.getenv("azure_openai_api_version", "2025-03-01-preview")

PRIMARY_REASONING_MODEL = os.getenv("PRIMARY_REASONING_LLM_MODEL", "aif-gpt-5-4-das-d-ussc-01")
ASSUMPTION_EVAL_MODEL = os.getenv("AZURE_OPENAI_DEPLOYMENT", "aif-gpt-4-1-das-d-ussc-01")

def get_openai_client() -> AsyncAzureOpenAI:
    return AsyncAzureOpenAI(
        api_key=AZURE_OPENAI_KEY,
        api_version=AZURE_OPENAI_API_VERSION,
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
    )
