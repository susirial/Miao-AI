# App Store Graphics

The public command `/app-store-graphics` starts this workflow. Selecting it alone means “begin”: if no usable app screenshots are attached, ask for 2–6 real screenshots and wait. Do not require or inspect a website.

## Fixed generation settings

- Use Seedream 5 Reference to Image (`seedream/5-pro-reference-to-image`) for both the design board and final graphics.
- Every image is `aspect_ratio: "9:16"` and `resolution: "1K"`.
- Do not ask about model, ratio, orientation, or resolution.
- Never use GPT Image, Flare, Sunburst, WaveSpeed, or a `background` parameter.
- This workflow produces generative marketing art, not an exact App Store pixel export. Be transparent that Seedream may not preserve screenshot pixels perfectly.

## Production gates

Complete these checkpoints in order and make each one recoverable. Never combine a question gate with generation in the same turn.

1. **Screenshots:** obtain 2–6 real screenshots when possible. With one screenshot, offer one final graphic. Do not invent capabilities not visible or stated.
2. **Copy language:** ask exactly one `app_store_copy_language` question. Recommend `en_us`; allow a custom language. This controls only agent-written on-image marketing copy.
3. **Design board:** generate one board using 1–3 representative screenshots in `reference_images`. It defines palette, typography, background, accents, shapes, spacing, and front-facing phone framing. It must be full-bleed 9:16 without a white outer border. Wait for the successful result URL.
4. **Brief:** ask `app_store_brief_confirmation`. Put the complete app name, screenshot labels, observed features, and visual direction in the top-level card prompt; keep the question itself short. Skip is not confirmation.
5. **Count:** ask `app_store_image_count`; recommend one final per screenshot in original order. Wait for the answer or skip.
6. **Finals:** generate one independent graphic for each selected screenshot.

Automatic approval must not bypass copy language, brief, or count gates.

## Design board

Use `generate_image(reference_images=[representative screenshots…])`. The board is a newly generated visual system, not an edit of one screenshot. It should show:

- app identity based on evidence;
- 4–6 palette swatches and roles;
- type hierarchy and accent/shape language;
- a large, straight-on modern Pro Max phone silhouette with placeholder screen;
- a mini headline-and-phone composition in the confirmed copy language.

Save the latest successful board result URL. A materially changed direction requires a revised board and another brief confirmation.

## Final graphics

For every final call `generate_image` with `reference_images` in this exact order:

1. the latest successful design board;
2. the current real app screenshot.

State the roles explicitly: image 1 controls exterior visual style only; image 2 is the screen UI. Use a large front-facing, straight-on phone (roughly 55–75% of frame height), thin bezel, no three-quarter angle, no perspective tilt, and no dramatic standing pose. Keep the screenshot sharp and readable, use the confirmed language only for marketing copy outside the phone, fill the 9:16 frame edge-to-edge, and avoid white borders, letterboxing, panoramas, continuous panels, or invented UI.

Inspect each result. If UI changed, the phone is tilted/small, text is wrong, or borders appear, use `result_fix_decision` and wait before regenerating—even under Automatic approval.
