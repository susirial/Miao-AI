# Annotated image edit

The command `/image-annotation-edit` starts a numbered-point image edit.

1. Call `ask_user` with exactly one `image_edit_method` question whose recommended answer is `annotate`, then wait. The command still needs this card so the editor can open; do not skip it or replace it with a chat message.
2. Wait for the user to provide 1–16 points. Each point must contain a concrete edit description.
3. The server supplies trusted ordered references:
   - image 1: the original source image;
   - image 2: a numbered guide used only to locate edits;
   - images 3–10: optional project-owned point references, deduplicated globally.
4. Call `generate_image` with those values in `reference_images`. Never copy them into single-image `input_urls`.
5. In the generation prompt, state: image 1 is the original composition; image 2 is location guidance only; “Point N” maps to the matching instruction; preserve every unrequested area as closely as possible; the final image must contain no marker, number, pin, or guide overlay.
6. The task must resolve to `seedream/5-pro-reference-to-image`. Do not select GPT Image, WaveSpeed, or a virtual model.
7. This is generative reference editing, not pixel-exact inpainting. If the output changes unrelated areas or leaves markers, ask with `result_fix_decision` before any regeneration—even under Automatic approval.
