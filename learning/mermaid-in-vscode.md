# Viewing the Mermaid diagrams in VS Code

The architecture docs use Mermaid code blocks. To render them in the VS Code markdown preview:

1. Install the `Markdown Preview Mermaid Support` extension.
2. Open a `.md` file containing a fenced block that starts with ` ```mermaid `.
3. Open the preview with `Ctrl + Shift + V`.

Notes:

- the diagram must be inside a fenced block starting with ` ```mermaid `
- the opening and closing backticks need their own lines
- if a diagram does not render, confirm the setup works with a tiny test diagram first

## A blocker worth recording

A clashing markdown extension stopped the diagrams rendering entirely. The fix was to search the extensions panel for "mermaid" and then "markdown", remove everything related, and reinstall only `Markdown Preview Mermaid Support`.
