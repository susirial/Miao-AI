# Agnes 3.0 Flash Protocol Probe

- Date: 2026-09-19
- Model: `agnes-3.0-flash`
- Endpoint: `https://apihub.agnes-ai.com/v1/chat/completions`
- Key source: local SQLite service settings (value never logged)

## Observations

| Request | HTTP | Content-Type | Finish reason | Content present | Reasoning fields | Tool calls |
| --- | ---: | --- | --- | --- | --- | --- |
| Non-stream basic | 200 | application/json | stop | true | n/a | n/a |
| Non-stream Thinking false | 200 | application/json | stop | true | n/a | n/a |
| Stream Thinking true | 200 | text/event-stream | stop | true | reasoning_content | none |
| Stream Thinking + forced tool | 200 | text/event-stream | tool_calls | false | reasoning_content | get_probe_value |

Observed stream delta keys:

- Thinking stream: content, reasoning_content, role
- Forced-tool stream: content, reasoning_content, role, tool_calls

## Frozen Decisions

- Complete and connection-test Thinking: send `chat_template_kwargs.enable_thinking: false`.
- Ordinary stream Thinking: enable; reasoning and final content are separable.
- Required-tool stream Thinking: enable; the forced tool returned a valid tool call.
- SSE parser aliases: `delta.reasoning_content`.
- Adapter reuse: 3.0 matches the frozen 2.5 Flash strategy; keep the shared Agnes Chat Completions adapter unchanged.

The fixtures contain sanitized response bodies only. Authorization headers, API keys, dynamic IDs, timestamps, and user project data are not stored.
