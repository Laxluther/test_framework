import httpx
import json

def build_payload(user_input: str, conversation_id: str, user_email: str, industry: str, is_new: bool, exit_das=False) -> dict:
    return {
        "userInput": user_input,
        "isNewConversation": is_new,
        "userEmail": user_email,
        "industry": industry,
        "conversationId": conversation_id,
        "exitDAS": exit_das,
    }

async def das_send(user_input: str, conversation_id: str, user_email: str, industry: str, is_new: bool, api_url: str, api_key: str) -> dict:
    payload = build_payload(user_input, conversation_id, user_email, industry, is_new)
    headers = {
        "Ocp-Apim-Subscription-Key": api_key,
        "Content-Type": "application/json"
    }
    
    timeout = httpx.Timeout(200.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"[DAS API Error] {e}")
            return {}
        except json.JSONDecodeError as e:
            print(f"[DAS Response Parse Error] {e}")
            return {}

async def das_end(conversation_id: str, user_email: str, industry: str, api_url: str, api_key: str) -> None:
    payload = build_payload("", conversation_id, user_email, industry, False, exit_das=True)
    headers = {
        "Ocp-Apim-Subscription-Key": api_key,
        "Content-Type": "application/json"
    }
    
    timeout = httpx.Timeout(30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            await client.post(api_url, json=payload, headers=headers)
        except Exception:
            pass

async def check_api_health(api_url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(api_url)
            # 400 means endpoint is up but requires POST body
            if resp.status_code in [200, 400, 401]: 
                return True
            return False
    except httpx.RequestError:
        return False
