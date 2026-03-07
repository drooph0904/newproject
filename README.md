# jira — QA Jira CLI

A command-line tool for QA engineers. Create daily tasks, file AI-structured bugs, export bug sheets to Google Sheets, and manage Jira issues — all without leaving the terminal.

---

## Install

```bash
npm install -g drooph0904/newproject
```

If that doesn't expose the `jira` command, run:

```bash
npm link
```

Requires **Node.js 18+**.

---

## First-Time Setup

Run the setup wizard once before using any command:

```bash
jira setup
```

The wizard walks you through three things: your Jira credentials, your AI provider key, and (optionally) Google Sheets for bug exports. Each step is explained below.

---

## Step 1 — Jira API Token (Atlassian)

The CLI needs your Jira email and an API token to create and manage issues on your behalf.

### How to get your Atlassian API token

1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   _(The setup wizard opens this page in your browser automatically)_
2. Click **Create API token**
3. Give it any label, e.g. `jira-cli`
4. Click **Create** — copy the token immediately (it won't be shown again)
5. Paste it into the terminal when prompted

The wizard also validates the token against your Jira workspace before saving, so you'll know right away if something is wrong.

**What gets saved:** your Jira email, API token, account ID, and workspace URL are stored in `~/.qa-jira/config.json` (readable only by you, permissions set to `600`).

---

## Step 2 — AI Provider Key (OpenRouter)

The AI key is used to structure bug descriptions and generate QA task summaries. OpenRouter is the recommended provider — it has a free tier with no credit card required.

### How to get an OpenRouter API key

1. Go to [openrouter.ai](https://openrouter.ai) and sign up (free)
2. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
   _(The setup wizard opens this page in your browser automatically)_
3. Click **Create Key**
4. Copy the key and paste it into the terminal when prompted

The setup wizard will do a quick test call to confirm the key works before saving it.

**Default model:** `nvidia/nemotron-3-nano-30b-a3b:free` — a free model that performs well for structured output. You can enter a different model name if you prefer.

**Alternatives:** You can also use MiniMax or any OpenAI-compatible API — just select your provider in the wizard.

---

## Step 3 — Google Sheets Setup (for `jira mk bugsheet`)

This step is only needed for the `jira mk bugsheet` command. You can skip it during `jira setup` and run `jira setup --google` later.

Google Sheets requires OAuth 2.0 credentials. Unlike service accounts, this uses **your own Google account** — sheets are created directly in your Drive.

### Part A — Create a Google Cloud Project and enable APIs

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Name it anything (e.g. `jira-cli`) → **Create**
4. Make sure your new project is selected in the dropdown

Now enable the two APIs the CLI needs:

5. In the left sidebar go to **APIs & Services → Library**
6. Search for **Google Sheets API** → click it → click **Enable**
7. Go back to Library, search for **Google Drive API** → click it → click **Enable**

### Part B — Configure the OAuth Consent Screen

Before creating OAuth credentials, Google requires you to set up an OAuth consent screen.

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** → click **Create**
3. Fill in:
   - **App name:** `jira-cli` (or anything)
   - **User support email:** your email
   - **Developer contact email:** your email
4. Click **Save and Continue**
5. On the **Scopes** page — click **Save and Continue** (no need to add scopes here)
6. On the **Test users** page — click **+ Add Users** and add your own Google email → **Save and Continue**
7. Click **Back to Dashboard**

### Part C — Create OAuth 2.0 Client Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Desktop app**
4. Name: `jira-cli` (or anything) → click **Create**
5. A popup shows your **Client ID** and **Client Secret** — copy both

### Part D — Run the Google setup wizard

```bash
jira setup --google
```

The wizard will:
1. Ask for your **Client ID** and **Client Secret** (paste from the popup above)
2. Open your browser to a Google sign-in page
3. You sign in and click **Allow**
4. The terminal automatically captures the authorisation and stores your refresh token — no copy-pasting of codes needed
5. Done — `jira mk bugsheet` will now work

Your refresh token is stored in `~/.qa-jira/config.json`. You will **never need to sign in again** — the token refreshes automatically.

> **If you see "App isn't verified":** Click **Advanced → Go to jira-cli (unsafe)** — this is expected for personal developer apps that haven't gone through Google's verification process.

---

## Commands

### `jira setup`

First-time configuration. Walks through Jira credentials, AI provider, and optionally Google Sheets.

```bash
jira setup
```

### `jira setup --google`

Configure Google Sheets integration on its own (if you skipped it during initial setup, or need to re-authorise).

```bash
jira setup --google
```

---

### `jira task create`

Create a daily QA task under an epic.

```bash
jira task create
```

**Flow:**
1. Enter the epic key (e.g. `QA-247`)
2. Pick what you worked on: tested a story / wrote test cases / other
3. Enter story key, bug IDs, notes, and optional attachment
4. AI generates a professional task description
5. Preview → confirm → task created and marked Done

Supports attaching files (screenshots, JMX, CSV, etc.) and Google Sheet links.

---

### `jira mk bug`

File a bug with an AI-structured description.

```bash
jira mk bug
```

**Flow:**
1. Describe the bug in plain English — as much or as little detail as you want
2. Pick environment (Production / Demo / Test)
3. AI structures it into: title, steps to reproduce, actual result, expected result
4. Pick priority (P1 Critical / P2 Major / P3 Minor)
5. Optionally assign an Assignee and Issue Owner (search by name)
6. Optionally attach a file or Google Sheet link
7. Search and select a Jira project and epic by name
8. Preview the full bug → confirm, edit in `$EDITOR`, or cancel
9. Bug is created and transitioned to In Progress

> The project you choose must have **Bug** as an available issue type. If it doesn't, the CLI will tell you which types are available.

---

### `jira mk bugsheet`

Export all bugs in an epic to a formatted Google Sheet.

```bash
jira mk bugsheet
```

**Flow:**
1. Search for a Jira project by partial name
2. Search for an epic within that project (or list all epics)
3. All bugs in the epic are fetched from Jira
4. A Google Sheet is created in your Drive with 12 columns:

| Column | Header | Content |
|--------|--------|---------|
| A | Bug ID | BUG_ID_1, BUG_ID_2… |
| B | Bug Type | Always "Bug" |
| C | Reported By | Reporter name from Jira |
| D | Reporting Date | Date created (DD-MMM-YYYY) |
| E | JIRA ID | Clickable link to the issue |
| F | Title | Issue summary |
| G | Current Status | Open / In Progress / Done etc. |
| H | Environment | Extracted from description, default UAT |
| I | Priority | P1 / P2 / P3 (or Highest / High / Medium) |
| J | RCA | Empty — fill in manually |
| K | Assignee | Assignee name, or "Unassigned" |
| L | Remarks | Empty — fill in manually |

**Sheet styling:**
- Header row: bold, dark blue background, white text
- Data rows: alternating white and light blue
- Column E: clickable hyperlinks to each Jira issue
- Row 1 frozen (stays visible when scrolling)
- All columns auto-resized to fit content

5. Sheet is shared publicly (anyone with the link can view)
6. The sheet URL is posted as a comment on the epic in Jira
7. Sheet opens in your browser automatically

> Requires `jira setup --google` to be completed first.

---

### `jira rm <KEY|URL>`

Delete a Jira issue permanently.

```bash
jira rm PROJ-123
jira rm https://yourcompany.atlassian.net/browse/PROJ-123
```

- Shows full issue details before asking for confirmation
- Default answer is **No** — you must explicitly confirm
- Deletion is permanent and cannot be undone
- Requires delete permissions on the project (contact your Jira admin if denied)

---

## Attachment Support

| Input | What happens |
|-------|-------------|
| Google Sheet URL | Added as a comment with a clickable link |
| `.jmx`, `.js`, `.json`, `.csv`, `.xml`, `.xlsx`, `.zip`, `.png`, `.jpg`, `.pdf` | Uploaded as a file attachment |

---

## Config File

All credentials are stored in `~/.qa-jira/config.json` with permissions `600` (only you can read it). To reset, delete the file and run `jira setup` again.

```
~/.qa-jira/config.json
```

---

## Requirements

- Node.js 18+
- Jira Cloud account with API access
- OpenRouter account (free) or any OpenAI-compatible API key
- Google Cloud project with Sheets + Drive APIs enabled (for `jira mk bugsheet`)
