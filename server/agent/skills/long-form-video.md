# Long-form video

Write chat replies and user-facing card text in the user's preferred language, including introductions, recommendations, question titles, questions, option labels, and descriptions. Follow the latest explicit language preference; otherwise use the language of the user's messages. Write each image/video generation prompt in that same preferred language, as one unmixed whole rather than English instructions wrapped around non-English lines. When the confirmed spoken language differs from it, name that language explicitly inside the prompt and quote the lines in it. Reference material does not override the user's language preference. Every ask_user question must include an Other option with `allow_custom: true` so the user can enter a custom answer.

Seedance 2.0 clips max out at 15s. A request for a longer video, a short film, a storyboard, long-form video, or a multi-beat story is **not** one `generate_video` call.

Production checkpoints below (model preference, total film duration, params, style, sound, spoken language, storyboard, character source) use **ask_user** cards and block the pipeline. They are not generation confirmation cards. Call ask_user even when generation confirmation is Automatic. Do not skip them by calling tools. Do not list the options in markdown — the card shows them. Skip on the card means they want you to decide.

## Pipeline

Stop at each gate until it is answered. Do not generate ahead. First resolve the model preference below, then offer settings for the selected models.

1. **Model preference — first, separate card** — unless the production models are already explicitly selected or delegated for this film, call **ask_user** with exactly one question, `model_preference`, using the options below. Stop and wait. Do not ask about topic, audience, duration, style, sound, language, or output settings in this call.
2. **Total duration, params, style & sound** — call **ask_user** for unresolved expected finished-film duration, video settings, visual style, and sound format together. Confirm total duration as described below; it is separate from individual clip duration. If sound includes dialogue or narration, also resolve the spoken language as described below. Wait for answers or explicit delegation before proceeding to the storyboard. An unanswered card is not a skipped card.
3. **Storyboard** — numbered shot list in chat. Call **ask_user** to confirm or revise before any still or clip.
4. **Character reference gate (mandatory)** — for every main or recurring character, establish whether the user has an identity reference image. If the source is unresolved, call **ask_user** and wait. If they have one, wait for the upload; if they have none, ask you to generate, or skip the card, generate a dedicated three-view sheet for each missing character. A written appearance description does not satisfy this gate. Follow the readiness check below before generating any shot still or clip.
5. **First frames** — one `generate_image` per shot (character sheet as `reference_images`).
6. **Clips** — one `generate_video` per shot: **image-to-video** (`first_frame` = that shot's first-frame still) or **reference-to-video** (`reference_images`, no `first_frame`).
7. **`concat_videos`** — only after every shot URL exists, in story order. Free; do not mix with generation tools in the same turn.

If a shot fails, regenerate that shot. Do not concatenate an incomplete cut.

Character sheets, first-frame stills, and clips are steps in this pipeline. After they succeed, continue — do not stop as if the user's request were done.

Give every generation a user-facing name that states its production stage as well as its subject or shot action. These names appear in the generation confirmation card’s job list. Use `name` for preset tools and `_name` for registered models, in the user's language: for example “Character sheet · Maya”, “Shot 1 first frame · Opening introduction”, or “Shot 1 video clip · Opening introduction”. Keep the actual storyboard number. A shot action alone does not distinguish a first-frame image from a video clip.

## Quality presets (long-form video only)

These presets belong exclusively to this long-form production workflow. They are not global preferences for standalone images, edits, or short videos. Apply a preset only after the model-preference gate below; never treat a stored runtime quality value as the user's choice for a new request. Explicit model selections take priority and use the registered model schemas.

- High quality: Seedream 5.0 Pro stills at 2K; Seedance 2.0 clips, up to 1080p.
- Economy: Seedream 5.0 Pro stills at 1K; Seedance 2.0 clips, initially 480p.
- Hobby: Seedream 5.0 Pro stills at 1K; Seedance 2.0 clips, initially 480p.
- Agnes: Agnes Image 2.5 Flash stills; Agnes Video 2.5 Flash clips at 720p, fixed ratios, no `generate_audio`. Only offer this when both Agnes image and video keys are ready.
- Custom: use the exact registered models selected for the film. Resolve missing model choices before production; use only documented schema defaults and request missing source media.

For Ark preset workflow, default video resolution is 480p unless the user specifies a higher supported resolution. Agnes presets stay on 720p. Registered custom models use their own schema defaults.

## Model preference (before family-specific settings)

The composer has no model-preference menu. When the user requests a new long video, the **first ask_user call must contain only the `model_preference` question**, before any topic, audience, style, sound, language, duration, parameter, or storyboard questions. Wait for its answer or explicit skip before moving on. The current runtime quality is a fallback, not evidence that the user chose it for this film. Automatic generation confirmation does not skip this card.

Use question id **`model_preference`**. The runtime replaces the options with the ready stacks. Call ask_user with that question id; do not invent Seedance-only menus. Localized labels should match these option ids when they are present:

- `ark-economy` — **Economy**: Seedream 5.0 Pro at 1K for stills; Seedance 2.0 initially at 480p for video.
- `ark-high` — **High quality**: Seedream 5.0 Pro at 2K for stills; Seedance 2.0 up to 1080p for video.
- `ark-hobby` — **Hobby**: Seedream 5.0 Pro at 1K for stills; Seedance 2.0 initially at 480p for video.
- `agnes` — **Agnes**: Image 2.5 Flash + Video 2.5 Flash (only when both Agnes media keys are ready).
- `custom` — **Custom**: use models the user specifies; resolve the exact image and video models before production.
- `other` — **Other**, with `allow_custom: true`, for a custom model combination or requirement.

Put the best fit first and set `recommended` to `ark-economy` when Ark is ready. Explain the recommended combination briefly. The runtime applies a selected preset, or the recommendation when the card/question is skipped, before continuing. Custom/Other switches to registered model tools; clarify unspecified models with ask_user and use their actual schemas. Do not interpret an empty custom answer as permission to invent model selections. After an Ark or Agnes stack is chosen, offer only that family's legal parameter values.

Do not repeat a model-preference card already answered for this film. Honor explicit @ models without asking the user to replace them; resolve any still/video role that remains unspecified through model-planning, using registered tools. If the user has already named a preset or delegated the setup without a card, use the matching registered models and actual schemas directly, stating the setup; do not assume an unsubmitted card changed runtime quality. Do not replace explicitly chosen models on retries or follow-up messages.

Do not bundle this card with any other question. The general advice to batch questions applies only after this first gate. Once the model choice is resolved, continue the remaining production checkpoints and batch related unresolved details there. If earlier turns accidentally collected creative details before model preference, keep those answers and ask the missing model-preference card next; do not repeat answered questions.

Example: “Make a five-minute educational video” already establishes a five-minute total runtime, but no model preference. The first response is a short introduction and one `model_preference` ask_user question with the setup options above. Do not ask the educational topic, visual style, sound format, or narration language yet. After the model answer, ask the remaining details; do not ask the five-minute runtime again.

## Expected total film duration (required detail checkpoint)

Resolve how long the **entire finished film** should be before drafting or confirming the storyboard or generating media, including when generation confirmation is Automatic.

- Reuse an explicit total duration or range already supplied by the user, including one entered through Other. Do not ask them to choose it again. A per-shot duration or the word “short” alone does not specify the total runtime.
- Otherwise, ask using **ask_user**, with question id `total_duration`, alongside the other unresolved film details. Use the user's preferred language.
- Infer **exactly three concrete total-duration options** from the requested purpose/platform, audience, story beats, amount of dialogue or narration, and intended pacing. Choose a concise version, a balanced version, and a more developed version that all make sense for this particular request. Put the best-fit option first and set its id as `recommended`.
- Each label must state a duration with units (seconds or minutes); each description should briefly explain what fits at that length. Do not use vague labels alone, and do not offer the same fixed durations for every project. For example, an advertising teaser might warrant 15/30/60 seconds, while a multi-scene educational story might warrant 1/2/3 minutes; these are illustrations, not a mandatory menu.
- Add a fourth **Other** option with `allow_custom: true` so the user can enter their own duration or range. Preserve that answer even if it exceeds one clip's model limit; split the film into multiple legal clips instead of shortening the whole film to that limit.
- Wait for an answer. If the user explicitly delegates duration or skips this question, state the recommended total runtime and proceed without asking again. An unanswered card is not delegation.
- Respect the six-question limit: prioritize total duration in the first film-detail card and carry remaining unresolved details to the next card.
- Use the selected total runtime as the storyboard budget: include planned seconds for each shot and the summed runtime. Keep shot durations legal for the active video family and make their sum match the target, or fall within a user-specified range. If a hard model constraint prevents an exact total, explain the closest feasible runtime and confirm it before generating. Do not let additional scenes, retries, or stitching silently lengthen the agreed film.

## Model & params

For preset tools, the runtime maps the card's confirmed preference to the video family. Offer only that family's options. Explicit/custom models use their registered schemas instead of the preset table.

| Preference | Family | Resolution | Aspect ratio | Duration | Audio | R2V caps |
|---|---|---|---|---|---|---|
| ark-economy | Seedance 2.0 | 480p, 720p, 1080p, 4k | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, adaptive | 4–15s | `generate_audio` | 9 stills / 3 clips |
| ark-high | Seedance 2.0 | 480p, 720p, 1080p, 4k | same as Economy | 4–15s | `generate_audio` | 9 stills / 3 clips |
| ark-hobby | Seedance 2.0 | 480p, 720p, 1080p, 4k | same as Economy | 4–15s | `generate_audio` | 9 stills / 3 clips |
| agnes | Agnes Video 2.5 Flash | 720p only | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 4–12s | omit `generate_audio` | stills only |

Image-to-video: `aspect_ratio` is always `adaptive` (do not offer a clip ratio for I2V). Reference-to-video: they pick a ratio from the table.

If they did **not** already specify the family/model **and** clip params (resolution, per-shot duration, audio, and ratio when not I2V):

- Call **ask_user** once, in the user's preferred language, with cards for the missing items. Include Other (`allow_custom`) where they might type a value. They can skip so you decide.
- Offer **only the active family's** options from the table. Do not dump other families.
- If they skip, or already said you decide: pick defaults and do not ask again.

Defaults when you decide:

- Ratio `16:9` unless they asked for vertical (`9:16`).
- Resolution: keep the quality default (480p unless they named 720p / 1080p / 4k).
- Per-shot duration (allocated within the confirmed total runtime): 5–8s by default, up to 15s. Snap to a legal Seedance 2.0 value.
- Audio follows the confirmed sound format below; do not silently default to dialogue or narration.
- Same aspect ratio and resolution for the whole cut.

If they already named a param, use it (clamped to the family). Do not re-ask.

## Visual style

Lock **one** visual style for the whole cut (character sheet, first frames, and clips). Restate it in every image and video prompt.

Skip this ask if they already named a style (photorealism / cinematic / anime / 3D / illustration / ink wash, a named artist or film look, etc.) or attached a still whose look is clearly the style reference.

If they did **not**:

- Call **ask_user** once, in the user's preferred language, together with the params questions when those are also open: visual style cards, plus Other (`allow_custom`) so they can type their own.
- Offer a short menu, not a dump — e.g. photoreal cinematic, anime, 3D animation, illustration.
- If they skip, or already said you decide: pick one concrete style that fits the story (default: photoreal cinematic unless the brief clearly points elsewhere) and state it in chat. Do not ask again.
- An attached person photo is identity, not automatically the film's visual style, unless they said to keep that photo's look.

## Sound format & spoken language (required detail checkpoint)

**Resolve sound before confirming the storyboard or generating media.** A bare `generate_audio: true`, the user's chat language, or dialogue appearing in a draft story does not answer these creative choices. Use **ask_user** even with Automatic generation confirmation. Reuse explicit answers already given; ask only for unresolved details. Each call supports at most six questions; carry remaining questions into a follow-up card instead of dropping sound or language confirmation.

### Sound format

Ask what the audience should hear, together with the other open video-detail questions. Offer these clearly distinguished options in the user's language:

- **Music only** — instrumental background music; no dialogue, narration, singing, or lyrics.
- **Dialogue** — characters speak on screen; no narrator or music unless separately requested.
- **Narration** — an off-screen narrator; no character dialogue or music unless separately requested.
- **All three** — music, character dialogue, and narration, arranged as appropriate across the film.
- **Silent** — no generated audio.
- **Other** with `allow_custom: true` — custom combinations such as music plus narration, dialogue plus music, ambience/sound effects only, or singing.

If they pick Other, honor the specified combination and clarify only material ambiguity. Do not infer “all three” from a general request for sound or a cinematic style. If they explicitly delegate or skip this card, choose instrumental music only and state that choice before the storyboard; do not treat lack of a reply as delegation.

### Spoken language (conditional follow-up)

- If the selected format includes **dialogue, narration, or both**, and no spoken language was explicitly specified, call **ask_user** before advancing: “Which language should the dialogue/narration use?” Offer **the current conversation language (name it explicitly)**, **English**, and **Other** with `allow_custom: true` for another language, dialect, or a multilingual arrangement. If the conversation is already in English, combine the first two into one English option.
- When the sound format is still unknown, ask it first, then ask language only if the answer requires speech. If speech is already requested, bundle the language card with the other missing details. Do not ask a language question for instrumental-only, silent, or sound-effects-only films. For requested singing, clarify lyric language if unspecified.
- One chosen language applies to both dialogue and narration unless the user specifies different languages; record that distinction when they do. Chat language is an offered choice, **not automatic consent** to that spoken language. An English generation prompt likewise does not imply English speech.
- If they explicitly delegate or skip the language card, use their current conversation language, name it, and continue. Preserve any explicit language choice across later batches, retries, and a change of chat language; change the film's spoken language only when requested.

### Apply the locked choices to shots

- In the text storyboard, give each shot its music/ambience plan and any exact spoken line, identifying the character or off-screen narrator and the spoken language. Keep speech short enough for that shot's duration. “All three” applies across the film, not simultaneous dialogue and narration over every shot; leave pauses and keep music below speech.
- In every video prompt, explicitly state the allowed audio, prohibited voices/music where relevant, and the selected spoken language. Write the production instructions in the user's preferred language and quote the actual spoken lines in the chosen spoken language. Example for Spanish narration inside an English prompt: `Audio: soft instrumental music under an off-screen narrator speaking Spanish: "Por fin reunió el valor para acercarse al dueño." No character dialogue.`
- Use `generate_audio: true` for shots with the selected music, speech, ambience, or effects; use `false` for silent shots. Never use the audio flag as a substitute for the sound plan. Do not add subtitles merely because dialogue or narration is requested.
- Carry the same soundtrack style, speaker descriptions, and language choices across clips and retries. `concat_videos` joins the clips; it does not create missing narration or supply a new soundtrack after generation.

## Storyboard

Write numbered shots **in chat only**. Each shot: duration, ratio, who is on screen, action, camera, and the locked sound plan (speaker/narrator, exact line and language when applicable).

- Prefer more short shots over one max-length clip. Aim for a complete beat per shot (entrance, action, or line), not a montage dump.
- Keep one aspect ratio and resolution for the whole cut so the stitch is clean.
- After the storyboard is locked: generate all missing character sheets together; after the required references succeed, submit all shot first frames together; after the required first frames succeed, submit all clips together; `concat_videos` last, alone. There is no fixed per-turn job-count cap. For seven ready shots, submit all seven in the same turn instead of splitting them into four and three. Keep each output as its own tool call.
- If the step limit hits, ask them to send continue. Do not skip concat.

**Stop after the shot list.** Call **ask_user** to confirm or revise (Other = they describe edits). Do not generate the character sheet, first frames, or clips until they approve, skip (you proceed), or send a revised list.

## Character prototype (identity reference)

**This is a blocking prerequisite for every main or recurring character, before any storyboard image, shot first frame, or video clip.** A text-only shot list may be drafted and confirmed first. Do not discover the missing reference after generating shot images. Skip this gate only when the film has no main or recurring characters.

### 1. Ask about the reference source, then wait

- Check the conversation and attached images for each character. An existing image counts only when the user supplied or selected it as that character's identity reference; an unrelated image, style reference, or textual appearance description does not count.
- If any character's source is unresolved, call **ask_user**: “Do you have an appearance reference image for [character names]? If not, I will generate one first to keep the character consistent across shots.” Use the user's language. Offer “I have a reference image; I will upload it”, “No reference image; generate one”, and Other with `allow_custom: true`. For multiple characters, establish which image belongs to whom and which characters need generation.
- **No attachment is not an answer.** Do not assume the user has no image just because they did not attach one. Ask and wait; do not call generation tools in the same turn as this unanswered question. Automatic generation confirmation and a general “make the whole video” request do not resolve the reference source.
- If they choose to upload, wait for the actual image. A promise to upload is not a usable reference. If they provide only a written look, use it to design the sheet after they confirm they have no image or want generation.
- Do not ask again when they have already supplied/selected a usable identity image, explicitly said they have no reference image, or explicitly asked you to design the character. Choosing “no image”, delegating character design, or skipping this source card means **generate the missing sheet**, never skip the reference requirement.

### 2. Establish a usable identity image for each character

- Reuse the user's designated identity image. If additional views are needed, generate a three-view sheet with that image in `input_urls` (one-image edit) or `reference_images` (new sheet from that identity), preserving the supplied identity.
- For each character without an image, call `generate_image` to create a **horizontal 16:9 full-body three-view sheet (front, side, back)** in the locked visual style. Keep clothing, hairstyle, facial features, proportions, and accessories consistent across the views. Use one dedicated sheet per character; a sheet for one actor does not cover the rest of the cast.
- Wait for successful image results and inspect them. A plan, prompt, pending job, failed image, or character description is not a reference image. If a sheet fails, retry or resolve that failure before generating shot stills or clips.

### 3. Check readiness and carry the identity into every shot

Before the first shot-image tool call, verify that every main or recurring character has a concrete, successfully available reference image URL/session image id and that each image is mapped to the correct character. If any is missing, return to the source or sheet-generation step. Keep those mappings for subsequent batches and retries; never use ambiguous `"latest"` to select among characters.

- Every shot's `generate_image.reference_images` must include the identity references for all recurring characters visible in that shot, even when their appearance is repeated in the text prompt.
- For image-to-video, pass the reference-conditioned shot still as `first_frame`; do not also set `reference_images`.
- For reference-to-video, pass the relevant character references in `reference_images`, together with the shot still as appropriate.
- Continue with the remaining film after the references succeed. They are an intermediate deliverable, not completion of the video request.

## First frames

After the storyboard is confirmed and the character sheet exists, generate **one still per shot** — the opening frame of that shot.

- `generate_image` with `reference_images` set to the character three-view (and any other locked identity stills).
- Match the locked film aspect ratio (not the sheet's 16:9 if the film is 9:16).
- Prompt: who, where, pose, camera, lighting for **that shot's first moment**, plus restated hair / wardrobe / age and the locked visual style.
- Submit all ready first-frame generations together in one turn. Do not split them into fixed-size batches; wait only for genuinely missing prerequisites.

Inspect each first frame. Retry only if it misses identity or the shot brief. After first frames exist, continue to clips — do not stop.

## Shots (video)

One `generate_video` per storyboard shot. Never text-to-video for a recurring character.

- **Image-to-video** when that shot has a first-frame still: `first_frame` = that still (URL or session id). Do not set `reference_images`. `aspect_ratio` = `adaptive`.
- **Reference-to-video** when the shot needs several identity / scene refs more than a single start frame (multi-character, product + person, or they asked for video from reference images): `reference_images` = character three-view plus the shot first frame and any extras. Do not set `first_frame`. Use the locked film ratio.
- Prefer image-to-video once first frames are ready, unless reference-to-video is clearly a better fit.
- Stay within the active model cap.
- Apply the locked sound format and spoken language from the sound checkpoint to every video prompt and its `generate_audio` flag.
- In the video prompt, name how each reference is used by its token (image 1, video 1, …), numbering each type from 1 in the order you pass it. Keep that order identical across shots and retries so a given character keeps the same number. Restate hair, wardrobe, age, and the locked visual style.
- Optional continuity: previous shot as `reference_videos` on reference-to-video only.
- Batches of 4; `concat_videos` last, alone.

## Concat

Call `concat_videos` with the clip URLs or session video ids **in story order**. Do not mix it with `generate_video` or `generate_image` in the same turn. Do not use `"latest"`. After the stitch, present the long video and stop.
