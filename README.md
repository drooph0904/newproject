# jira

QA Jira CLI — create tasks, file AI-structured bugs, and manage issues from the terminal.

## Install

```bash
npm install -g drooph0904/newproject
```

After installing, link the CLI:

```bash
npm link
```

## Setup

Run the setup wizard (one-time):

```bash
jira setup
```

The wizard will:
- Configure your Jira workspace credentials
- Open your browser to the Jira API token page
- Set up an AI provider for description generation (free tier available)
- Validate both credentials before saving

## Commands

### `jira setup`

First-time configuration. Sets up Jira credentials and AI provider.

### `jira task create`

Create a daily QA task under an epic:

```bash
jira task create
```

- Prompts for epic, task type (tested / wrote test cases / other), and details
- AI generates a professional Jira task description
- Creates the task with correct dates, labels, and status (Done)
- Optionally attaches files or Google Sheet links

### `jira mk bug`

Create a bug with an AI-structured description:

```bash
jira mk bug
```

- Describe the bug in your own words
- Pick environment (Production / Demo / Test)
- AI converts it into structured fields: title, steps to reproduce, actual/expected result, environment
- Pick priority (P1/P2/P3)
- Search and assign an Assignee and Issue Owner
- Optionally attach a file or Google Sheet link
- Search for project and epic by name
- Preview before creating
- Bug is created and transitioned to In Progress

> **Note:** The project you select must have "Bug" as an available issue type. If it doesn't, the CLI will tell you and you can pick a different project.

> **Note:** Deleting issues (`jira rm`) requires delete permissions on the project. If you don't have them, contact your Jira admin.

### `jira rm <ID|URL>`

Delete a Jira issue by key or URL:

```bash
jira rm PROJ-123
jira rm https://company.atlassian.net/browse/PROJ-123
```

- Shows issue summary before confirming
- Requires explicit confirmation (default: no)
- Permanent deletion — cannot be undone

## Attachment Types

| Type | Action |
|------|--------|
| Google Sheet URL | Added as comment with link |
| .jmx, .js, .json, .csv, .xml, .xlsx, .zip | Uploaded as file attachment |

## Requirements

- Node.js 18+
- Jira Cloud account with API access
