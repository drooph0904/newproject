#!/usr/bin/env node
import { input, select, password, confirm } from '@inquirer/prompts'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'fs'
import { execSync } from 'child_process'
import axios from 'axios'
import { getConfig, setup } from './config.js'
import {
  getEpicInfo, fetchIssueDetails, createTask, transitionToDone,
  attachFileToIssue, addCommentWithLink, deleteIssue,
  searchProjects, searchEpicsInProject, searchUsers, createBug,
} from './jira.js'
import { generateDescription, generateBugDescription } from './aiDescriber.js'
import { makeDoc, makeParagraph, makeText } from './adfBuilder.js'
import { detectInputType, validateFile, getFileTypeLabel } from './fileHandler.js'

// Parse: jira <command> [subcommand] [args...]
const [,, cmd, sub, ...rest] = process.argv

async function printHelp() {
  console.log('\n' + chalk.cyan('  jira') + chalk.dim(' — QA Jira CLI\n'))
  console.log('  ' + chalk.green('jira setup') + '          ' + chalk.dim('First-time configuration'))
  console.log('  ' + chalk.green('jira task create') + '   ' + chalk.dim('Create a daily QA task'))
  console.log('  ' + chalk.green('jira mk bug') + '        ' + chalk.dim('Create a bug with AI-structured description'))
  console.log('  ' + chalk.green('jira rm <ID|URL>') + '  ' + chalk.dim('Delete a Jira issue by key or URL'))
  console.log()
}

if (cmd === 'setup') {
  await setup()
} else if (cmd === 'task' && sub === 'create') {
  await create()
} else if (cmd === 'rm') {
  const target = sub || rest[0]
  if (!target) {
    console.log(chalk.red('Usage: jira rm <ISSUE-KEY or URL>'))
    process.exit(1)
  }
  await rm(target)
} else if (cmd === 'mk' && sub === 'bug') {
  await mkBug()
} else {
  await printHelp()
}

// ── rm ───────────────────────────────────────────────────────────────────────

async function rm(target) {
  const config = await getConfig()
  const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64')

  process.stdout.write(chalk.dim('  Looking up issue...\r'))
  let issue
  try {
    issue = await fetchIssueDetails(config.jiraBaseUrl, auth, target)
    console.log('\r' + chalk.dim('  Found: ') + chalk.cyan(issue.key) + ' — ' + issue.summary)
    console.log(chalk.dim('  Type: ') + issue.issueType + '  Status: ' + issue.status)
  } catch (err) {
    console.log(chalk.red('\r✗ ' + err.message))
    process.exit(1)
  }

  console.log()
  console.log(chalk.red('  ⚠  This will permanently delete ' + issue.key + '. This cannot be undone.'))
  const confirmed = await confirm({
    message: chalk.red(`Delete ${issue.key} — "${issue.summary}"?`),
    default: false,
  })

  if (!confirmed) {
    console.log(chalk.dim('  Cancelled.'))
    process.exit(0)
  }

  process.stdout.write(chalk.dim('  Deleting...\r'))
  try {
    await deleteIssue(config.jiraBaseUrl, auth, issue.key)
    console.log(chalk.green('✔ Deleted: ') + chalk.cyan(issue.key) + chalk.dim(' — ' + issue.summary))
  } catch (err) {
    console.log(chalk.red('✗ ' + err.message))
    process.exit(1)
  }
}

// ── mk bug ───────────────────────────────────────────────────────────────────

async function mkBug() {
  const startTime = Date.now()
  const config = await getConfig()
  const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64')

  console.log(chalk.cyan('\n  jira mk bug — AI-powered bug creator\n'))

  // Step 1: Raw bug description
  const rawDescription = await input({
    message: 'Describe the bug (in your own words, be as detailed as you want):',
  })

  if (!rawDescription.trim()) {
    console.log(chalk.red('Description cannot be empty.'))
    process.exit(1)
  }

  // Step 2: Environment
  const environment = await select({
    message: 'Environment:',
    choices: [
      { name: 'Production', value: 'Production' },
      { name: 'Demo', value: 'Demo' },
      { name: 'Test', value: 'Test' },
    ]
  })

  // Step 3: AI structures the description (includes environment)
  process.stdout.write(chalk.cyan('🤖 Structuring bug report...\r'))
  let bugAI
  try {
    bugAI = await generateBugDescription({ config, rawDescription, environment })
    console.log(chalk.green('✔') + ' Bug report structured by AI')
  } catch (err) {
    console.log(chalk.yellow('⚠ AI failed: ' + err.message + ' — using manual input'))
    bugAI = {
      title: rawDescription.slice(0, 80),
      stepsToReproduce: [rawDescription],
      actualResult: 'See description',
      expectedResult: 'Correct behavior',
      adf: makeDoc([makeParagraph([makeText(rawDescription)])]),
      preview: rawDescription,
    }
  }

  // Step 3: Priority
  const priority = await select({
    message: 'Priority:',
    choices: [
      { name: 'P1 — Critical / Blocker (Highest)', value: 'P1' },
      { name: 'P2 — Major (High)', value: 'P2' },
      { name: 'P3 — Minor (Medium)', value: 'P3' },
    ]
  })

  // Step 4: Assignee search
  let assigneeAccountId = null
  const assigneeQuery = await input({ message: 'Assignee name (press enter to skip):' })

  if (assigneeQuery.trim()) {
    process.stdout.write(chalk.dim('  Searching users...\r'))
    try {
      const users = await searchUsers(config.jiraBaseUrl, auth, assigneeQuery.trim())
      if (users.length === 0) {
        console.log(chalk.yellow('⚠ No users found for "' + assigneeQuery + '" — leaving unassigned'))
      } else if (users.length === 1) {
        assigneeAccountId = users[0].accountId
        console.log(chalk.green('✔') + ' Assigned to: ' + users[0].displayName)
      } else {
        console.log(chalk.dim('\n  Select assignee:'))
        users.forEach((u, i) => console.log(`  ${i + 1}. ${u.displayName} (${u.emailAddress})`))
        console.log(`  ${users.length + 1}. Skip — leave unassigned\n`)
        const pick = await input({ message: 'Enter number:' })
        const idx = parseInt(pick) - 1
        if (idx >= 0 && idx < users.length) {
          assigneeAccountId = users[idx].accountId
          console.log(chalk.green('✔') + ' Assigned to: ' + users[idx].displayName)
        } else {
          console.log(chalk.dim('  Unassigned'))
        }
      }
    } catch (err) {
      console.log(chalk.yellow('⚠ User search failed: ' + err.message + ' — leaving unassigned'))
    }
  }

  // Step 5: Issue Owner search
  let issueOwnerAccountId = null
  let issueOwnerName = null
  const ownerQuery = await input({ message: 'Issue Owner name (press enter to skip):' })

  if (ownerQuery.trim()) {
    process.stdout.write(chalk.dim('  Searching users...\r'))
    try {
      const users = await searchUsers(config.jiraBaseUrl, auth, ownerQuery.trim())
      if (users.length === 0) {
        console.log(chalk.yellow('⚠ No users found for "' + ownerQuery + '" — skipping'))
      } else if (users.length === 1) {
        issueOwnerAccountId = users[0].accountId
        issueOwnerName = users[0].displayName
        console.log(chalk.green('✔') + ' Issue Owner: ' + users[0].displayName)
      } else {
        console.log(chalk.dim('\n  Select Issue Owner:'))
        users.forEach((u, i) => console.log(`  ${i + 1}. ${u.displayName} (${u.emailAddress})`))
        console.log(`  ${users.length + 1}. Skip\n`)
        const pick = await input({ message: 'Enter number:' })
        const idx = parseInt(pick) - 1
        if (idx >= 0 && idx < users.length) {
          issueOwnerAccountId = users[idx].accountId
          issueOwnerName = users[idx].displayName
          console.log(chalk.green('✔') + ' Issue Owner: ' + users[idx].displayName)
        } else {
          console.log(chalk.dim('  No owner selected'))
        }
      }
    } catch (err) {
      console.log(chalk.yellow('⚠ User search failed: ' + err.message + ' — skipping'))
    }
  }

  // Step 7: Attachment
  let attachmentInfo = null
  const attachInput = await input({ message: 'Attach screenshot/file or Google Sheet? (path or URL, enter to skip):' })

  if (attachInput.trim()) {
    const inputType = detectInputType(attachInput.trim())
    if (inputType === 'google-sheet') {
      attachmentInfo = { type: 'google-sheet', url: attachInput.trim(), label: 'Google Sheet', name: 'Google Sheet link' }
      console.log(chalk.green('✔') + ' Google Sheet detected')
    } else if (inputType === 'file') {
      try {
        const fileInfo = await validateFile(attachInput.trim())
        attachmentInfo = { type: 'file', filePath: fileInfo.filePath, fileName: fileInfo.fileName, label: getFileTypeLabel(fileInfo.ext), name: fileInfo.fileName }
        console.log(chalk.green('✔') + ` File: ${fileInfo.fileName}`)
      } catch (err) {
        console.log(chalk.yellow('⚠ ' + err.message + ' — skipping attachment'))
      }
    } else {
      console.log(chalk.yellow('⚠ Not a valid file path or Google Sheet URL — skipping'))
    }
  }

  // Step 6: Search for project/space
  let selectedProject = null
  while (!selectedProject) {
    const projectQuery = await input({ message: 'Search for Jira project/space (type partial name):' })
    process.stdout.write(chalk.dim('  Searching projects...\r'))

    try {
      const projects = await searchProjects(config.jiraBaseUrl, auth, projectQuery.trim())
      if (projects.length === 0) {
        console.log(chalk.yellow('⚠ No projects found for "' + projectQuery + '" — try again'))
        continue
      }
      console.log(chalk.dim('\n  Select project:'))
      projects.forEach((p, i) => console.log(`  ${i + 1}. [${p.key}] ${p.name}`))
      console.log()
      const pick = await input({ message: 'Enter number:' })
      const idx = parseInt(pick) - 1
      if (idx >= 0 && idx < projects.length) {
        selectedProject = projects[idx]
        console.log(chalk.green('✔') + ' Project: ' + selectedProject.name + ' (' + selectedProject.key + ')')
      } else {
        console.log(chalk.yellow('Invalid selection — try again'))
      }
    } catch (err) {
      console.log(chalk.red('✗ Project search error: ' + err.message))
    }
  }

  // Step 7: Search for epic within project
  let selectedEpic = null
  const skipEpic = await select({
    message: 'Link to an epic?',
    choices: [
      { name: 'Yes — search for an epic', value: 'yes' },
      { name: 'No — create bug without epic', value: 'no' },
    ]
  })

  if (skipEpic === 'yes') {
    while (!selectedEpic) {
      const epicQuery = await input({ message: 'Search for epic (type partial name or press enter to list all):' })
      process.stdout.write(chalk.dim('  Searching epics...\r'))

      try {
        const epics = await searchEpicsInProject(config.jiraBaseUrl, auth, selectedProject.key, epicQuery.trim())
        if (epics.length === 0) {
          console.log(chalk.yellow('⚠ No epics found — try different search or press enter to skip'))
          const skipNow = await select({
            message: 'What would you like to do?',
            choices: [
              { name: 'Search again', value: 'retry' },
              { name: 'Create bug without epic', value: 'skip' },
            ]
          })
          if (skipNow === 'skip') break
          continue
        }
        console.log(chalk.dim('\n  Select epic:'))
        epics.forEach((e, i) => console.log(`  ${i + 1}. [${e.key}] ${e.summary}`))
        console.log(`  ${epics.length + 1}. None — no epic\n`)
        const pick = await input({ message: 'Enter number:' })
        const idx = parseInt(pick) - 1
        if (idx >= 0 && idx < epics.length) {
          selectedEpic = epics[idx]
          console.log(chalk.green('✔') + ' Epic: ' + selectedEpic.summary + ' (' + selectedEpic.key + ')')
        } else {
          console.log(chalk.dim('  No epic selected'))
          break
        }
      } catch (err) {
        console.log(chalk.yellow('⚠ Epic search failed: ' + err.message))
        break
      }
    }
  }

  // Step 8: Preview
  const divider = chalk.cyan('─'.repeat(58))
  console.log('\n' + divider)
  console.log(chalk.cyan('  BUG PREVIEW'))
  console.log(divider)
  console.log(chalk.dim('  Title:    ') + chalk.white(bugAI.title))
  console.log(chalk.dim('  Project:  ') + selectedProject.name + ' (' + selectedProject.key + ')')
  if (selectedEpic) console.log(chalk.dim('  Epic:     ') + selectedEpic.summary + ' (' + selectedEpic.key + ')')
  console.log(chalk.dim('  Priority: ') + chalk.yellow(priority))
  console.log(chalk.dim('  Environ:  ') + environment)
  if (assigneeAccountId) console.log(chalk.dim('  Assignee: ') + 'Selected user')
  if (issueOwnerName) console.log(chalk.dim('  Owner:    ') + issueOwnerName)
  if (attachmentInfo) console.log(chalk.dim('  Attach:   ') + attachmentInfo.name)
  console.log(divider)
  console.log('\n  ' + bugAI.preview.split('\n').join('\n  ') + '\n')
  console.log(divider + '\n')

  // Step 9: Confirm
  const action = await select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Create this bug', value: 'create' },
      { name: 'Edit description in $EDITOR', value: 'edit' },
      { name: 'Cancel', value: 'cancel' },
    ]
  })

  if (action === 'cancel') {
    console.log(chalk.dim('Cancelled.'))
    process.exit(0)
  }

  if (action === 'edit') {
    const tmp = `/tmp/jira-bug-${Date.now()}.txt`
    fs.writeFileSync(tmp, bugAI.preview)
    execSync(`${process.env.EDITOR || 'nano'} ${tmp}`, { stdio: 'inherit' })
    const edited = fs.readFileSync(tmp, 'utf-8')
    fs.unlinkSync(tmp)
    bugAI.adf = makeDoc(edited.split('\n\n').filter(Boolean).map(p => makeParagraph([makeText(p)])))
    bugAI.preview = edited
    console.log(chalk.green('✔') + ' Description updated')
  }

  // Step 10: Create bug
  process.stdout.write(chalk.dim('  Creating bug in Jira...\r'))
  let issueKey, issueUrl
  try {
    const result = await createBug(config.jiraBaseUrl, auth, {
      projectKey: selectedProject.key,
      epicKey: selectedEpic?.key || null,
      summary: bugAI.title,
      description: bugAI.adf,
      priority,
      assigneeAccountId,
      issueOwnerAccountId,
      environment,
      label: null,
    })
    issueKey = result.issueKey
    issueUrl = result.issueUrl
  } catch (err) {
    console.log(chalk.red('✗ ' + err.message))
    process.exit(1)
  }

  // Step 11: Attachment
  if (attachmentInfo?.type === 'file') {
    process.stdout.write(chalk.dim(`  Uploading ${attachmentInfo.fileName}...\r`))
    try {
      await attachFileToIssue(config.jiraBaseUrl, auth, issueKey, attachmentInfo.filePath)
      console.log(chalk.green('✔') + ' File attached: ' + attachmentInfo.fileName)
    } catch (err) {
      console.log(chalk.yellow('⚠ Upload failed: ' + err.message))
    }
  } else if (attachmentInfo?.type === 'google-sheet') {
    try {
      await addCommentWithLink(config.jiraBaseUrl, auth, issueKey, 'Reference (Google Sheet)', attachmentInfo.url)
      console.log(chalk.green('✔') + ' Google Sheet link added as comment')
    } catch (err) {
      console.log(chalk.yellow('⚠ Comment failed: ' + err.message))
    }
  }

  // Step 12: Transition to In Progress
  process.stdout.write(chalk.dim('  Setting status to In Progress...\r'))
  try {
    const res = await axios.get(
      `${config.jiraBaseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      { headers: { 'Authorization': 'Basic ' + auth } }
    )
    const inProgressTransition = res.data.transitions.find(t =>
      t.name.toLowerCase().includes('progress') || t.name.toLowerCase().includes('start')
    )
    if (inProgressTransition) {
      await axios.post(
        `${config.jiraBaseUrl}/rest/api/3/issue/${issueKey}/transitions`,
        { transition: { id: inProgressTransition.id } },
        { headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' } }
      )
      console.log(chalk.green('✔') + ' Status: In Progress')
    } else {
      console.log(chalk.dim('  (Status left as default — set manually if needed)'))
    }
  } catch {
    // Non-fatal
  }

  // Done
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n' + '═'.repeat(50))
  console.log(chalk.red('  🐛 Bug Created: ') + chalk.cyan.bold(issueKey))
  console.log(chalk.dim('  🔗 ') + chalk.cyan.underline(issueUrl))
  console.log('═'.repeat(50))
  console.log(chalk.dim(`\n  Done in ${elapsed}s\n`))
}

// ── task create (existing flow, unchanged) ───────────────────────────────────

async function create() {
  const startTime = Date.now()
  const config = await getConfig()
  const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64')
  const today = dayjs().format('YYYY-MM-DD')

  const epicKeyRaw = await input({ message: 'Which epic? (e.g. QA-247):' })
  const epicKey = epicKeyRaw.trim().toUpperCase()
  process.stdout.write(chalk.dim('  Validating epic...\r'))
  const epic = await getEpicInfo(config.jiraBaseUrl, auth, epicKey)
  console.log(chalk.green('✔') + ' Epic: ' + chalk.cyan(epic.key) + ' — ' + epic.summary)

  const taskType = await select({
    message: 'What did you work on today?',
    choices: [
      { name: 'Tested a Jira Story', value: 'tested' },
      { name: 'Wrote Test Cases for a Story', value: 'testcases' },
      { name: 'Other / General QA work', value: 'other' },
    ]
  })

  let storyInput = '', bugInput = '', userNotes = '', attachmentInput = ''

  if (taskType === 'tested') {
    storyInput = await input({ message: 'Story you tested (key or URL, enter to skip):' })
    bugInput = await input({ message: 'Bug IDs you filed (comma-separated, enter to skip):' })
    userNotes = await input({ message: 'Extra notes (enter to skip):' })
    attachmentInput = await input({ message: 'Attach file or Google Sheet? (path or URL, enter to skip):' })
  } else if (taskType === 'testcases') {
    storyInput = await input({ message: 'Story you wrote test cases for (key or URL, enter to skip):' })
    userNotes = await input({ message: 'Extra notes (enter to skip):' })
    attachmentInput = await input({ message: 'Attach test case file or Google Sheet? (path or URL, enter to skip):' })
  } else {
    userNotes = await input({ message: 'What did you work on? (brief description):' })
    bugInput = await input({ message: 'Bug IDs you filed (comma-separated, enter to skip):' })
    attachmentInput = await input({ message: 'Attach file or Google Sheet? (path or URL, enter to skip):' })
  }

  let attachmentInfo = null
  if (attachmentInput.trim()) {
    const inputType = detectInputType(attachmentInput.trim())
    if (inputType === 'google-sheet') {
      attachmentInfo = { type: 'google-sheet', url: attachmentInput.trim(), label: 'Google Sheet', name: 'Google Sheet link' }
      console.log(chalk.green('✔') + ' Google Sheet detected — will be added as a comment')
    } else if (inputType === 'file') {
      try {
        const fileInfo = await validateFile(attachmentInput.trim())
        attachmentInfo = { type: 'file', filePath: fileInfo.filePath, fileName: fileInfo.fileName, label: getFileTypeLabel(fileInfo.ext), name: fileInfo.fileName }
        console.log(chalk.green('✔') + ` File: ${fileInfo.fileName} (${getFileTypeLabel(fileInfo.ext)})`)
      } catch (err) {
        console.log(chalk.yellow('⚠') + ' ' + err.message + ' — skipping attachment')
      }
    } else {
      console.log(chalk.yellow('⚠') + ' Could not identify as file or Google Sheet — skipping')
    }
  }

  let storyDetails = null
  const bugDetailsList = []
  if (storyInput.trim()) {
    process.stdout.write(chalk.dim('  Fetching story...\r'))
    try {
      storyDetails = await fetchIssueDetails(config.jiraBaseUrl, auth, storyInput.trim())
      console.log(chalk.green('✔') + ' Story: ' + chalk.white(storyDetails.summary))
    } catch (err) {
      console.log(chalk.yellow('⚠') + ` Story fetch failed: ${err.message} — continuing`)
    }
  }
  if (bugInput.trim()) {
    const bugKeys = bugInput.split(',').map(b => b.trim()).filter(Boolean)
    for (const bugKey of bugKeys) {
      process.stdout.write(chalk.dim(`  Fetching bug ${bugKey}...\r`))
      try {
        const bugDetails = await fetchIssueDetails(config.jiraBaseUrl, auth, bugKey)
        bugDetailsList.push(bugDetails)
        console.log(chalk.green('✔') + ' Bug: ' + chalk.cyan(bugDetails.key) + ' — ' + chalk.white(bugDetails.summary))
      } catch (err) {
        console.log(chalk.yellow('⚠') + ` Bug ${bugKey} fetch failed: ${err.message} — continuing`)
      }
    }
  }

  process.stdout.write(chalk.cyan('🤖 Generating description...\r'))
  let aiResult
  try {
    aiResult = await generateDescription({ config, taskType, storyDetails, bugDetailsList, userNotes, attachmentInfo })
    console.log(chalk.green('✔') + ' Description generated')
  } catch (err) {
    console.log(chalk.yellow('⚠') + ' AI failed: ' + err.message)
    const fallback = await input({ message: 'Enter description manually:' })
    aiResult = { adf: makeDoc([makeParagraph([makeText(fallback)])]), preview: fallback }
  }

  const suggestedSummary = storyDetails
    ? (taskType === 'tested' ? `QA Testing — ${storyDetails.key}` : `Test Case Creation — ${storyDetails.key}`)
    : `QA Task — ${epic.key} — ${today}`
  const summary = await input({ message: 'Task summary:', default: suggestedSummary })

  const labelRaw = await input({ message: 'Label (optional):' })
  const label = labelRaw.trim().replace(/\s+/g, '-') || null
  if (labelRaw.trim() && label !== labelRaw.trim()) {
    console.log(chalk.dim(`  Label adjusted: ${label}`))
  }

  const divider = chalk.cyan('─'.repeat(58))
  console.log('\n' + divider)
  console.log(chalk.cyan('  TASK PREVIEW'))
  console.log(divider)
  console.log(chalk.dim('  Epic:     ') + epic.key + ' — ' + epic.summary)
  console.log(chalk.dim('  Summary:  ') + summary)
  if (label) console.log(chalk.dim('  Label:    ') + chalk.green(label))
  console.log(chalk.dim('  Date:     ') + today)
  console.log(chalk.dim('  Assignee: ') + 'You (auto-set)')
  if (attachmentInfo) console.log(chalk.dim('  Attach:   ') + (attachmentInfo.type === 'google-sheet' ? '🔗' : '📎') + ' ' + attachmentInfo.name)
  console.log(divider)
  const preview = aiResult.preview.length > 500 ? aiResult.preview.slice(0, 500) + chalk.dim('...') : aiResult.preview
  console.log('\n  ' + preview.split('\n').join('\n  ') + '\n')
  console.log(divider + '\n')

  const action = await select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Create this task', value: 'create' },
      { name: 'Edit description in $EDITOR', value: 'edit' },
      { name: 'Cancel', value: 'cancel' },
    ]
  })

  if (action === 'cancel') { console.log(chalk.dim('Cancelled.')); process.exit(0) }

  if (action === 'edit') {
    const tmp = `/tmp/qa-jira-${Date.now()}.txt`
    fs.writeFileSync(tmp, aiResult.preview)
    execSync(`${process.env.EDITOR || 'nano'} ${tmp}`, { stdio: 'inherit' })
    const edited = fs.readFileSync(tmp, 'utf-8')
    fs.unlinkSync(tmp)
    aiResult.adf = makeDoc(edited.split('\n\n').filter(Boolean).map(p => makeParagraph([makeText(p)])))
    aiResult.preview = edited
    console.log(chalk.green('✔') + ' Description updated')
  }

  process.stdout.write(chalk.dim('  Creating task...\r'))
  const { issueKey, issueUrl } = await createTask(config.jiraBaseUrl, auth, {
    epicKey: epic.key,
    summary,
    description: aiResult.adf,
    label,
    startDate: today,
    dueDate: today,
    assigneeAccountId: config.accountId,
  })

  // Transition task to Done
  process.stdout.write(chalk.dim('  Setting status to Done...\r'))
  try {
    const transitioned = await transitionToDone(config.jiraBaseUrl, auth, issueKey)
    if (transitioned) {
      console.log(chalk.green('✔') + ' Status set to Done')
    }
  } catch (err) {
    console.log(chalk.yellow('⚠') + ' Could not set Done status: ' + err.message)
  }

  if (attachmentInfo?.type === 'file') {
    process.stdout.write(chalk.dim(`  Uploading ${attachmentInfo.fileName}...\r`))
    try {
      await attachFileToIssue(config.jiraBaseUrl, auth, issueKey, attachmentInfo.filePath)
      console.log(chalk.green('✔') + ` ${attachmentInfo.label} attached`)
    } catch (err) {
      console.log(chalk.yellow('⚠') + ` Upload failed: ${err.message}`)
      console.log(chalk.dim(`  Attach manually at: ${issueUrl}`))
    }
  } else if (attachmentInfo?.type === 'google-sheet') {
    try {
      await addCommentWithLink(config.jiraBaseUrl, auth, issueKey, 'Test Cases (Google Sheet)', attachmentInfo.url)
      console.log(chalk.green('✔') + ' Google Sheet link added as comment')
    } catch (err) {
      console.log(chalk.yellow('⚠') + ` Comment failed: ${err.message}`)
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n' + '═'.repeat(50))
  console.log(chalk.green('  ✅ Created: ') + chalk.cyan.bold(issueKey))
  console.log(chalk.dim('  🔗 ') + chalk.cyan.underline(issueUrl))
  console.log('═'.repeat(50))
  console.log(chalk.dim(`\n  Done in ${elapsed}s\n`))
}
