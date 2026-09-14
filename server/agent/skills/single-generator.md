# Single generator

Use this skill when the user invokes a generator for a standalone image, image edit, or single video clip, especially through an explicit model name or @[Name](model:id). Follow model-planning for exact model selection and schema validation. For a long film, storyboard, or multi-shot production, use long-form-video instead; do not add a second set of standalone checkpoints to its intermediate generations.

## Check the brief before generation

Read the selected tool's input schema and reuse the user's instructions, previous answers, and designated session media. An @ mention selects the model and task; it does not specify a subject, visual style, or output settings.

Resolve missing required inputs and meaningful creative/output choices with **ask_user** before calling a generation tool. This checkpoint also applies with Automatic generation confirmation. A spending confirmation or _uncertain_fields is not a substitute for answering these questions.

- **Creative direction:** if the request is only a model mention, ask what to create. If it is vague (such as “a cat”, “make a nice image”, or “animate this”), offer a few concrete directions grounded in the supplied subject or reference. Combine subject, setting, composition, and style into coherent proposals when that avoids several tiny questions. Do not silently turn your proposal into the user's intent.
- **Image settings:** resolve aspect ratio and resolution/quality when exposed by the selected schema and not already supplied or clearly implied by the intended use. A phone wallpaper can establish orientation; it does not establish an exact resolution. Offer documented defaults as recommendations, not as already confirmed answers. Do not ask for a style when a detailed prompt or explicitly designated style reference already settles it.
- **Video settings:** resolve the intended action/motion, clip duration, supported resolution, ratio when configurable, and sound when supported. Offer only settings legal for the selected model and input mode. If dialogue, narration, or singing is requested, resolve the spoken/lyric language unless already specified; chat language and an audio flag do not resolve it. Do not ask about speech for silent or instrumental-only clips.
- **Edits:** identify the source and what to change or keep. Reuse compatible media only when its intended role is clear.
- **Other parameters:** ask for required values without usable defaults. Omit optional technical controls such as seeds or negative prompts unless relevant to the user's request. Do not require users to fill every schema field.

A schema default alone does not settle a missing creative choice or the image/video settings above. A single legal value needs no question. Explicit delegation (“you decide”, “use defaults”, “surprise me”) settles the choices it covers: state the chosen direction/settings briefly and proceed using legal values. A complete brief proceeds directly without an extra approval card.

## Confirmation cards

Batch related unresolved choices into one **ask_user** call, usually one to four questions, at most six. Prioritize creative direction and indispensable parameters; carry any remaining necessary questions into the next card.

- Use stable question ids such as `creative_direction`, `aspect_ratio`, `resolution`, `duration`, and `sound_format`.
- Offer two or three concrete, distinct choices per question, or fewer if the schema permits fewer. Put the best fit first and set `recommended` to its option id. Briefly explain the effect of each choice. Adapt creative proposals to this request; do not reuse a generic menu for every subject.
- Include an **Other** option with `allow_custom: true` in every question. Accept custom intent, but validate custom parameter values against the selected schema before generating. If incompatible, explain the constraint and offer legal alternatives; do not silently clamp the user's choice.
- Use the user's preferred language for the introduction, recommendation, titles, questions, labels, and descriptions. Keep parameter keys and actual enum values in API format. Write the production prompt in that same language as one unmixed whole, keeping requested on-image text and quoted speech in the language the user chose for them.
- Show choices through the card, not a duplicate markdown list. Include a short top-level recommendation explaining what you will choose if they skip.
- Stop until the card is answered or explicitly skipped. Do not mix **ask_user** with generation or `concat_videos` in the same turn. Silence, an unanswered card, and Automatic generation confirmation are not delegation.

When an indispensable image/video/audio file is missing, plainly request the upload or a usable URL and wait. A card may select among existing assets or clarify reference roles; it cannot upload a file. Skipping cannot supply a missing asset. Do not generate a prerequisite or replace the selected model/task without authorization.

## Continue after answers

Merge answers with the existing brief. Preserve the exact selected model, supplied parameters, and reference roles. Do not ask the same question again; a skip delegates only the skipped choices. Resolve only newly introduced ambiguities or invalid combinations.

Once the brief is ready, compile the prompt and call the selected registered model_* tool with its actual schema fields, legal parameter combinations, available media, and a localized _name. Follow the existing confirmation policy. Do not add storyboard approval, character sheets, or other long-form stages to a standalone request. Present successful outputs; explain failures without claiming success or repeatedly retrying unchanged requests.

## Examples of the decision boundary

- **@Text to Image + “a cat”:** ask for a concrete direction (for example, a sunlit photographic pet portrait, a playful illustrated cat, or a cinematic night scene), plus unresolved supported ratio and resolution settings. Include Other in each question and wait before generating.
- **@Text to Image only:** ask for the desired content with a few suggested starting points and Other; there is no subject yet. Suggestions are proposals, not inferred requirements.
- **Detailed prompt + supported ratio and resolution:** generate directly; do not ask for style or reconfirm supplied settings.
- **@Text to Image + “a cat, you decide everything else”:** choose a coherent direction and documented output defaults, state them briefly, then generate.
- **@Image to Video without a source image:** request the actual image. Skipping creative questions does not unblock the required media input.
- **@Text to Video + “a 90-second multi-scene story”:** route to long-form-video using the chosen model's actual limits; do not shorten it into one standalone clip.
