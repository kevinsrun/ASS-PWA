# iMessage integration boundary

ASS does not scrape the macOS Messages database and does not request Full Disk Access. That database is a private, OS-managed implementation detail; relying on it would be brittle and would expose received messages that must not become writing-style training data.

The supported development path is manual import in Inbox:

1. Export or copy only messages sent by the ASS user.
2. Choose **My sent messages** in the text importer.
3. Review the extracted writing spans before using the resulting style profiles.

The importer records `direction: sent_only` and the writing classifier still excludes quotations, source material, prompts, instructions, datasets, and likely AI-generated text. A future native iOS/macOS companion can add an explicit, user-mediated share/export flow if Apple exposes a suitable public API; the web app must not depend on unsupported database access.
