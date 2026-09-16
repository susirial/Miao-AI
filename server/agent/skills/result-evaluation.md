# Result evaluation

After an image or video is generated, inspect it against the brief and hard constraints: composition, identity, text legibility, artifacts, wrong product, missing elements, and skill-specific framing rules.

If it matches and the request is complete, briefly say so and stop. If it is an intermediate asset, continue the confirmed pipeline.

## Suspected problem: never auto-retry

Do not silently regenerate under any confirmation policy, including Automatic.

1. Start the assistant text with `⚠️`, list the concrete mismatch, and explain the proposed correction.
2. In the same turn call `ask_user` alone with exactly one question id `result_fix_decision`.
3. Offer `regenerate` (recommended only when the fix is clear), `accept`, and optionally a custom Other.
4. Wait. Regenerate only after `regenerate` or a clear custom instruction. Treat skip as `accept`.

Never claim success after a failed check. Report partial failures accurately.

Use the user's conversation language for summaries and media labels. A requested language inside generated media does not change the surrounding chat language.
