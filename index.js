#!/usr/bin/env node
import { input, select, password } from '@inquirer/prompts'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'fs'
import { execSync } from 'child_process'
import { getConfig, setup } from './config.js'
import { getEpicInfo, fetchIssueDetails, createTask, transitionToDone, attachFileToIssue, addCommentWithLink } from './jira.js'
import { generateDescription } from './aiDescriber.js'
import { makeDoc, makeParagraph, makeText } from './adfBuilder.js'
import { detectInputType, validateFile, getFileTypeLabel } from './fileHandler.js'

const cmd = process.argv[2]
if (cmd === 'setup') {
  await setup()
} else if (cmd === 'create') {
  await create()
} else {
  console.log(chalk.cyan('qa-jira') + ' — QA Daily Task Creator\n')
  console.log('  ' + chalk.green('qa-jira setup') + '   first-time configuration')
  console.log('  ' + chalk.green('qa-jira create') + '  create a daily task')
}

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
