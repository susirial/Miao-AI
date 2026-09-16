# Image editing

Use this workflow whenever the user asks to change an existing image.

- If the requested edit is already precise, generate the edit directly.
- If the request is ambiguous about where multiple edits belong, ask one standalone `image_edit_method` choice with:
  - `describe`: continue by written description.
  - `annotate`: let the user place numbered points (recommended).
- A literal `/image-annotation-edit` command still uses the `image_edit_method` card, with `annotate` preselected, so the editor can open. Do not skip the card or answer it in chat.
- The image being edited comes only from the current request attachments. For a follow-up with no new attachment, use the most recent image-bearing message.
- Never treat the whole project gallery as source-image candidates. Project images may only be selected as additional point references.
- Do not generate until the user confirms the pending choice and the normal generation confirmation gate has been satisfied.
