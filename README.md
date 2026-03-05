# qa-jira

QA daily task creator for Jira with AI-generated descriptions.

## Install

```bash
npm install -g drooph0904/newproject
```

## Setup

Run the setup wizard (one-time):

```bash
qa-jira setup
```

The wizard will:
- Open your browser to the Jira API token page
- Open your browser to the AI key page (free tier available)
- Validate both credentials before saving

## Usage

Create a daily QA task:

```bash
qa-jira create
```

## What it does

1. Prompts you for an epic, task type, and details
2. Uses AI to generate a professional Jira task description
3. Creates the task under your epic with correct dates and status
4. Optionally attaches files or Google Sheet links

## Attachment Types

| Type | Action |
|------|--------|
| Google Sheet URL | Added as comment with link |
| .jmx, .js, .json, .csv, .xml, .xlsx, .zip | Uploaded as file attachment |

## Requirements

- Node.js 18+
- Jira Cloud account with API access
