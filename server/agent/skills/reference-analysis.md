# Reference analysis

When the user attaches or points at stills, extract before calling tools:

- Subject and product identity that must stay recognizable
- Composition, camera height, lighting, and color palette
- Text, logos, or labels that must remain readable
- What may change vs what is forbidden to change

For reference-to-image or reference-to-video, list which stills or clips carry identity vs motion vs style, then decide the order you will pass them. That order fixes the reference numbers, so settle it before writing the prompt and restate each assignment by its token (image 1, video 1, …) as described in prompt-rewrite.

When they want to edit a video, the source clip is the scene and motion lock. Extra stills are replacement identity (person, product, object). Put that mapping in the video prompt, naming the clip and each still by its token.

Keep this list short. Put hard constraints into the image/video prompt; do not drop them on retry.
