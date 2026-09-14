# Prompt rewrite

Compile the user request into a model-ready prompt:

- Use the user's preferred language for chat replies and user-facing cards. Follow the latest explicit language preference, otherwise use the language of the user's messages
- Write the whole generation prompt in that same language. Visual, motion, and camera instructions are not routed through English first: a Chinese request produces a Chinese prompt, an English request an English one. Both models read either language natively, so translating costs meaning and buys nothing
- Keep one language per prompt. Dialogue, narration, lyrics, and on-image text normally match the prompt language, which leaves nothing mixed. Mixed-language prompts degrade spoken output, so the only places two languages may meet are proper nouns and a deliberately different spoken language
- When the user did choose a different spoken language, keep the surrounding prompt in their preferred language, name that language explicitly, and quote the actual lines in it. Preserve this choice across shots, rewrites, and retries. Example inside an otherwise English prompt: `Dialogue in Spanish: "Papá, quiero ayudarlo."`
- Preserve hard constraints from reference analysis, including a locked visual style on long-form jobs
- Seedream 5.0 Pro: photographic/art-direction detail, not a caption dump
- Seedance 2.0: subject motion, camera move, pacing, and first/last-frame intent
- First-frame stills for a storyboard shot: opening composition, identity from the character three-view, locked visual style, no motion language
- Image-to-video: motion that starts from that first frame
- Reference-to-image: say how each still is used (identity, wardrobe, product, style), using the reference tokens below. This is a new scene, not an edit of one source image
- Reference-to-video: say how each still or clip is used (identity, product, style, motion, first-frame composition), using the reference tokens below
- Do not invent reference URLs

## Reference tokens

Seedream and Seedance identify a reference by its type and position, never by URL, session id, or asset id. An unnumbered reference leaves the model guessing which asset carries identity, which carries motion, and which carries style.

- Number each type separately, starting at 1, in the order you pass them: `generate_image.reference_images` and `generate_video.reference_images` produce image 1, image 2, …; `reference_videos` produce video 1, video 2, …; reference audio is numbered the same way.
- Write the token in the language of the surrounding prompt — `图片1` / `视频1` / `音频1` in a Chinese prompt, `Image 1` / `Video 1` / `Audio 1` in an English one. Do not mix both forms in one prompt.
- Give every reference you pass an explicit role. Unlabelled references compete with the labelled ones.
- For images, pass at most 10 reference stills. For video, pass at most 9 reference images and 3 reference videos, and only those you actually name. Filling the slots dilutes priority instead of adding control.
- Keep the order stable across retries and follow-up shots: reordering the array renumbers every later reference and silently rebinds the roles you wrote.

Sentence patterns:

- Image reference: take the white mecha from image 1 and the green mecha from image 2, then describe the new battle scene.
- Multimodal reference: take the character from image 1, the wardrobe from image 2, and the camera move from video 1, then describe the new shot.
- Video edit: edit video 1 and name only what changes; anything unmentioned stays as-is. Do not write "reference video 1" for an edit — that reads as a request for a brand-new scene.
- Video extension: extend video 1 forward or backward, then describe the continuation.
