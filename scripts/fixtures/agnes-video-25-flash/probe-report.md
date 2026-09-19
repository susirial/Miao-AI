# Agnes Video 2.5 Flash Protocol Baseline

- Model: `agnes-video-2.5-flash`
- Create endpoint: `https://apihub.agnes-ai.com/v1/videos`
- Query endpoint: `https://apihub.agnes-ai.com/agnesapi`
- Key source: local SQLite service settings (value never logged)

## Documentation Contract

These rules follow the official Agnes Video 2.5 Flash documentation. They are **not** a frozen live protocol: the probe received HTTP 503 and then the free-account HTTP 429 before a task was created. Query fields, `video_id`, and the finished-asset URL stay a documentation contract until a probe reaches `completed`. Do not add a fake `completed` fixture.

- Creation and polling payloads follow the official Agnes Video 2.5 Flash documentation.
- Polling uses `video_id` plus `model_name=agnes-video-2.5-flash` as documented.
- `size` is documented as `720P`; `seconds` is a string from `4` through `12`.
- Reference mode accepts at most five images and three audio URLs and never sends `videos`.
- Audio control is `none`; no `generate_audio` value is sent.
- Video Data URI input is **not verified**.
- Until a successful probe reaches `completed`, video inputs accept public HTTPS URLs only. Local `/media/` and Data URI inputs are rejected.

No failed live response fixture is committed because it reflects account quota rather than the media protocol. API keys, request IDs, account data, and signed URLs are not stored.
