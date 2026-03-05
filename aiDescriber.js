import axios from 'axios'
import { makeDoc, makeParagraph, makeText, makeLink, makeRule } from './adfBuilder.js'

function buildPrompt(taskType, storyDetails, bugDetails, userNotes, attachmentInfo) {
  const storyBlock = storyDetails ? `
STORY KEY: ${storyDetails.key}
STORY TITLE: ${storyDetails.summary}
STORY DESCRIPTION: ${storyDetails.descriptionText || 'No description provided.'}
STORY TYPE: ${storyDetails.issueType}
STORY STATUS: ${storyDetails.status}` : 'No story provided.'

  const bugBlock = bugDetails ? `
BUG KEY: ${bugDetails.key}
BUG TITLE: ${bugDetails.summary}
BUG DESCRIPTION: ${bugDetails.descriptionText || 'No description provided.'}` : null

  const attachBlock = attachmentInfo
    ? `I am also attaching: ${attachmentInfo.label} (${attachmentInfo.name})`
    : ''

  const notesBlock = userNotes?.trim() ? `Additional notes from me: ${userNotes}` : ''

  if (taskType === 'tested') {
    return `I am a QA engineer. Today I tested the following Jira story:
${storyBlock}
${bugBlock ? `\nI found and filed the following bug:\n${bugBlock}` : '\nNo bugs were found during testing.'}
${notesBlock}
${attachBlock}

Write a Jira task description. Return ONLY this JSON (no backticks, no explanation):
{
  "paragraph1": "2-3 sentences: what the story was about and what I tested. Based ONLY on the story details above.",
  "paragraph2": "${bugBlock ? '2-3 sentences: the bug I found, its nature and impact. Based ONLY on bug details above.' : '2-3 sentences: testing outcome, coverage, and result.'}",
  "outcome": "1 sentence: final status of this testing task."
}`
  }

  if (taskType === 'testcases') {
    return `I am a QA engineer. Today I wrote test cases for the following Jira story:
${storyBlock}
${notesBlock}
${attachBlock}

Write a Jira task description. Return ONLY this JSON (no backticks, no explanation):
{
  "paragraph1": "2-3 sentences: what this story is about and what functionality needed test coverage. Based ONLY on story details above.",
  "paragraph2": "2-3 sentences: the specific flows, scenarios, and edge cases I would cover in test cases for THIS story specifically.",
  "outcome": "1 sentence: completion status."
}`
  }

  // taskType === 'other'
  return `I am a QA engineer. Today I did the following work:
${userNotes}
${attachBlock}

Write a Jira task description. Return ONLY this JSON (no backticks, no explanation):
{
  "paragraph1": "2-3 sentences: professional description of the work done.",
  "paragraph2": "2-3 sentences: the approach, methodology, or tools involved.",
  "outcome": "1 sentence: completion status."
}`
}

export async function generateDescription({ config, taskType, storyDetails, bugDetails, userNotes, attachmentInfo }) {
  const response = await axios.post(
    config.aiBaseUrl + '/chat/completions',
    {
      model: config.aiModel,
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: 'You are a QA engineer writing professional Jira task descriptions. Write in first person. Be specific. Never invent details not given to you. Return ONLY valid JSON with keys: paragraph1, paragraph2, outcome. No markdown fences. No extra text.'
        },
        { role: 'user', content: buildPrompt(taskType, storyDetails, bugDetails, userNotes, attachmentInfo) }
      ]
    },
    { headers: { 'Authorization': 'Bearer ' + config.aiApiKey, 'Content-Type': 'application/json' } }
  )

  let raw = response.data.choices[0].message.content
  raw = raw.replace(/```json|```/g, '').trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = { paragraph1: raw.slice(0, 500), paragraph2: '', outcome: 'Task completed.' }
  }

  const blocks = []
  if (parsed.paragraph1) blocks.push(makeParagraph([makeText(parsed.paragraph1)]))
  if (parsed.paragraph2) blocks.push(makeParagraph([makeText(parsed.paragraph2)]))
  if (parsed.outcome) blocks.push(makeParagraph([makeText(parsed.outcome, true)]))

  if (storyDetails || bugDetails) blocks.push(makeRule())
  if (storyDetails) {
    blocks.push(makeParagraph([makeText('Story: ', true), makeLink(storyDetails.key, storyDetails.url)]))
  }
  if (bugDetails) {
    blocks.push(makeParagraph([makeText('Bug Found: ', true), makeLink(bugDetails.key, bugDetails.url)]))
  }
  if (attachmentInfo?.type === 'google-sheet') {
    blocks.push(makeParagraph([makeText('Test Cases (Google Sheet): ', true), makeLink('Open Sheet', attachmentInfo.url)]))
  }

  const adf = makeDoc(blocks)
  const preview = [parsed.paragraph1, parsed.paragraph2, parsed.outcome].filter(Boolean).join('\n\n')

  return { adf, preview }
}
