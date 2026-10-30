"""Provider adapters, against a fake OpenAI-compatible server that behaves like Gemini 3."""
import asyncio
import json

import httpx

from sentinel.agent.llm import OpenAICompatLLM

SIGNATURE = "opaque-signature-123"


def gemini_like(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    assistant_calls = [c for m in body["messages"] if m["role"] == "assistant" for c in m.get("tool_calls") or []]
    # Like Gemini 3: every function call sent back must carry its thought_signature.
    if any(c.get("extra_content", {}).get("google", {}).get("thought_signature") != SIGNATURE for c in assistant_calls):
        return httpx.Response(400, json={"error": {"message": "Function call is missing a thought_signature"}})
    if assistant_calls:
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "done"}}]})
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [{
        "id": "call_1", "type": "function", "function": {"name": "get_active_alerts", "arguments": "{}"},
        "extra_content": {"google": {"thought_signature": SIGNATURE}},
    }]}}]})


def test_tool_call_signatures_are_sent_back():
    llm = OpenAICompatLLM("gemini-test", "https://fake.local/v1", "key", "gemini")
    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(gemini_like))

    async def go():
        messages = [{"role": "user", "content": "investigate"}]
        first = await llm.chat(messages, [])
        assert first.tool_calls[0].name == "get_active_alerts"
        messages += [first.as_message(), {"role": "tool", "tool_call_id": "call_1", "content": "[]"}]
        second = await llm.chat(messages, [])  # a 400 here raises
        return second.content

    assert asyncio.run(go()) == "done"


# --- tool calls a model wrote as text -----------------------------------------------------------------------------------

TOOLS = [{"type": "function", "function": {"name": n, "description": "", "parameters": {}}}
         for n in ("get_active_alerts", "find_common_cause", "propose_action")]


def test_a_tool_call_written_as_json_text_is_recovered():
    from sentinel.agent.llm import extract_tool_calls

    one = extract_tool_calls('{"name": "get_active_alerts", "arguments": {}}', TOOLS)
    assert [(c.name, c.args) for c in one] == [("get_active_alerts", {})]
    fenced = extract_tool_calls('Let me check.\n```json\n{"name": "find_common_cause", "arguments": {"services": ["a", "b"]}}\n```', TOOLS)
    assert [(c.name, c.args) for c in fenced] == [("find_common_cause", {"services": ["a", "b"]})]
    tagged = extract_tool_calls('<tool_call>{"name": "find_common_cause", "arguments": "{\\"services\\": [\\"x\\"]}"}</tool_call>', TOOLS)
    assert [(c.name, c.args) for c in tagged] == [("find_common_cause", {"services": ["x"]})]
    wrapped = extract_tool_calls('[{"function": {"name": "get_active_alerts", "arguments": {}}}, {"name": "find_common_cause", "parameters": {"services": ["q"]}}]', TOOLS)
    assert [c.name for c in wrapped] == ["get_active_alerts", "find_common_cause"]
    assert all(c.id.startswith("call_") for c in wrapped)


def test_text_that_is_not_a_call_to_an_offered_tool_stays_an_answer():
    from sentinel.agent.llm import extract_tool_calls

    assert extract_tool_calls("The root cause is the payments service.", TOOLS) == []
    assert extract_tool_calls('{"name": "delete_everything", "arguments": {}}', TOOLS) == []     # not an offered tool
    assert extract_tool_calls('[{"name": "get_active_alerts"}, {"name": "rm -rf"}]', TOOLS) == []  # one bad call spoils the list
    assert extract_tool_calls('{"root_cause": "payments"}', TOOLS) == []
    assert extract_tool_calls("", TOOLS) == [] and extract_tool_calls("x", []) == []


def test_a_model_that_answers_in_text_still_drives_the_agent(monkeypatch):
    import asyncio

    import httpx

    from sentinel.agent.llm import OllamaLLM

    async def fake_post(client, url, body):
        return {"message": {"role": "assistant", "content": '{"name": "get_active_alerts", "arguments": {}}'}}

    monkeypatch.setattr("sentinel.agent.llm._post_with_retry", fake_post)
    reply = asyncio.run(OllamaLLM("m", "http://x").chat([{"role": "user", "content": "go"}], TOOLS))
    assert [c.name for c in reply.tool_calls] == ["get_active_alerts"] and reply.content == ""


def test_the_configured_ollama_model_is_used_when_installed_and_a_close_one_when_not():
    from sentinel.agent.llm import pick_ollama_model

    assert pick_ollama_model("qwen3:8b", ["qwen3:8b", "llama3:8b"]) == "qwen3:8b"
    assert pick_ollama_model("qwen3:8b", ["llama3:8b", "qwen3:4b"]) == "qwen3:4b"      # same family first
    assert pick_ollama_model("qwen3:8b", ["qwen2.5-coder:7b"]) == "qwen2.5-coder:7b"  # then whatever is there
    assert pick_ollama_model("qwen3:8b", []) == "qwen3:8b"                             # nothing installed: say what failed, as before
