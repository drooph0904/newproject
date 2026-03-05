import axios from 'axios'
import { makeDoc, makeParagraph, makeText, makeLink, makeRule, makeBulletList } from './adfBuilder.js'

function buildBugsBlock(bugDetailsList) {
  if (!bugDetailsList || bugDetailsList.length === 0) return null
  return bugDetailsList.map((bug, i) => `
BUG ${i + 1} KEY: ${bug.key}
BUG ${i + 1} TITLE: ${bug.summary}
BUG ${i + 1} DESCRIPTION: ${bug.descriptionText || 'No description provided.'}
BUG ${i + 1} STATUS: ${bug.status}`).join('\n')
}

function buildPrompt(taskType, storyDetails, bugDetailsList, userNotes, attachmentInfo) {
  const storyBlock = storyDetails ? `
STORY KEY: ${storyDetails.key}
STORY TITLE: ${storyDetails.summary}
STORY DESCRIPTION: ${storyDetails.descriptionText || 'No description provided.'}
STORY TYPE: ${storyDetails.issueType}
STORY STATUS: ${storyDetails.status}` : 'No story provided.'

  const bugsBlock = buildBugsBlock(bugDetailsList)
  const bugCount = bugDetailsList?.length || 0

  const attachBlock = attachmentInfo
    ? `I am also attaching: ${attachmentInfo.label} (${attachmentInfo.name})`
    : ''

  const notesBlock = userNotes?.trim() ? `Additional notes from me: ${userNotes}` : ''

  if (taskType === 'tested') {
    return `I am a QA engineer. Today I tested the following Jira story:
${storyBlock}
${bugsBlock ? `\nI found and filed the following ${bugCount} bug(s) during testing:\n${bugsBlock}` : '\nNo bugs were found during testing.'}
${notesBlock}
${attachBlock}

Write a detailed, professional Jira task description. Return ONLY this JSON (no backticks, no explanation):
{
  "summary": "4-5 sentences describing what the story is about, what specific functionality or feature I tested, what areas and user flows I covered, and the overall scope of testing. Be specific about what was validated — reference actual features, screens, or behaviors from the story description.",
  "details": "4-5 sentences explaining my testing approach in detail — what types of testing I performed (functional, regression, edge cases, cross-browser, etc.), specific scenarios I validated, boundary conditions I checked, and how thorough the coverage was. Mention specific test scenarios where possible.",
  ${bugsBlock ? `"bugs": "For each bug: 2-3 sentences describing what the bug is, how it manifests, what the expected vs actual behavior is, and the potential impact on users. Be specific about each bug's nature and severity.",` : ''}
  "outcome": "2 sentences: final status of testing — whether the story passed or failed QA, how many bugs were found, and whether the story is ready for release or needs fixes first."
}`
  }

  if (taskType === 'testcases') {
    return `I am a QA engineer. Today I wrote test cases for the following Jira story:
${storyBlock}
${notesBlock}
${attachBlock}

Write a detailed, professional Jira task description. Return ONLY this JSON (no backticks, no explanation):
{
  "summary": "4-5 sentences describing what this story is about, what functionality needs test coverage, and why these test cases are important. Reference specific features and behaviors from the story.",
  "details": "4-5 sentences explaining the specific test scenarios, user flows, edge cases, and boundary conditions I covered in the test cases. Mention positive tests, negative tests, and any data-driven scenarios. Be specific about what each group of test cases validates.",
  "outcome": "2 sentences: completion status and total number of test cases created, plus any areas that may need additional coverage."
}`
  }

  // taskType === 'other'
  return `I am a QA engineer. Today I did the following work:
${userNotes}
${bugsBlock ? `\nI also found and filed the following ${bugCount} bug(s):\n${bugsBlock}` : ''}
${attachBlock}

Write a detailed, professional Jira task description. Return ONLY this JSON (no backticks, no explanation):
{
  "summary": "4-5 sentences providing a professional, detailed description of the QA work performed. Expand on what was done, why it was important, and what areas of the product it relates to. Make it sound thorough and professional.",
  "details": "4-5 sentences explaining the approach, methodology, tools used, and specific actions taken. Include what was analyzed, reviewed, or investigated and any decisions or findings that came out of the work.",
  ${bugsBlock ? `"bugs": "For each bug: 2-3 sentences describing what the bug is, how it manifests, what the expected vs actual behavior is, and the potential impact on users.",` : ''}
  "outcome": "2 sentences: final status of the work — what was accomplished, any follow-ups needed, and whether any bugs were filed."
}`
}

export async function generateDescription({ config, taskType, storyDetails, bugDetailsList, userNotes, attachmentInfo }) {
  const response = await axios.post(
    config.aiBaseUrl + '/chat/completions',
    {
      model: config.aiModel,
      max_tokens: 1500,
      messages: [
        {
          role: 'system',
          content: 'You are a senior QA engineer writing detailed, professional Jira task descriptions. Write in first person. Be specific and thorough. Never invent details not given to you — only elaborate on what is provided. Return ONLY valid JSON. No markdown fences. No extra text. Use the exact keys requested.'
        },
        { role: 'user', content: buildPrompt(taskType, storyDetails, bugDetailsList, userNotes, attachmentInfo) }
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
    parsed = { summary: raw.slice(0, 800), details: '', outcome: 'Task completed.' }
  }

  const blocks = []

  // Summary section
  if (parsed.summary) {
    blocks.push(makeParagraph([makeText('Summary', true)]))
    blocks.push(makeParagraph([makeText(parsed.summary)]))
  }

  // Details section
  if (parsed.details) {
    blocks.push(makeParagraph([makeText('Details', true)]))
    blocks.push(makeParagraph([makeText(parsed.details)]))
  }

  // Bugs section
  if (parsed.bugs) {
    blocks.push(makeParagraph([makeText('Bugs Found', true)]))
    blocks.push(makeParagraph([makeText(parsed.bugs)]))
  }

  // Outcome section
  if (parsed.outcome) {
    blocks.push(makeParagraph([makeText('Outcome', true)]))
    blocks.push(makeParagraph([makeText(parsed.outcome)]))
  }

  // References section
  if (storyDetails || (bugDetailsList && bugDetailsList.length > 0)) {
    blocks.push(makeRule())
  }

  if (storyDetails) {
    blocks.push(makeParagraph([makeText('Story: ', true), makeLink(storyDetails.key + ' — ' + storyDetails.summary, storyDetails.url)]))
  }

  if (bugDetailsList && bugDetailsList.length > 0) {
    for (const bug of bugDetailsList) {
      blocks.push(makeParagraph([makeText('Bug: ', true), makeLink(bug.key + ' — ' + bug.summary, bug.url)]))
    }
  }

  if (attachmentInfo?.type === 'google-sheet') {
    blocks.push(makeParagraph([makeText('Test Cases: ', true), makeLink('Open Google Sheet', attachmentInfo.url)]))
  }

  const adf = makeDoc(blocks)

  // Build clean preview text (no JSON keys, no quotes)
  const previewParts = []
  if (parsed.summary) previewParts.push('Summary\n' + parsed.summary)
  if (parsed.details) previewParts.push('Details\n' + parsed.details)
  if (parsed.bugs) previewParts.push('Bugs Found\n' + parsed.bugs)
  if (parsed.outcome) previewParts.push('Outcome\n' + parsed.outcome)

  if (storyDetails) previewParts.push('Story: ' + storyDetails.key + ' — ' + storyDetails.summary)
  if (bugDetailsList?.length > 0) {
    previewParts.push('Bugs: ' + bugDetailsList.map(b => b.key).join(', '))
  }

  const preview = previewParts.join('\n\n')

  return { adf, preview }
}

export async function generateBugDescription({ config, rawDescription }) {
  const systemPrompt = `You are a QA engineer writing structured Jira bug reports.
You receive a raw description of a bug and convert it into a professional structured report.
Return ONLY valid JSON. No markdown fences. No explanation. No preamble.
Response format:
{
  "title": "Short descriptive bug title, max 80 chars, starts with a verb",
  "stepsToReproduce": ["Step 1...", "Step 2...", "Step 3..."],
  "actualResult": "What actually happens",
  "expectedResult": "What should happen instead",
  "additionalContext": "Any extra context, environment info, or notes (can be empty string)"
}`

  const userPrompt = `Convert this bug description into a structured report:

"${rawDescription}"

Rules:
- Title must be specific and descriptive, not generic like "Bug found"
- Steps must be numbered, actionable, and specific
- If steps are not clear from the description, infer reasonable steps based on the context
- Actual result: what went wrong
- Expected result: what the correct behavior should be
- Return ONLY the JSON object`

  let raw
  try {
    const response = await axios.post(
      config.aiBaseUrl + '/chat/completions',
      {
        model: config.aiModel,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ]
      },
      {
        headers: {
          'Authorization': 'Bearer ' + config.aiApiKey,
          'Content-Type': 'application/json',
        }
      }
    )
    raw = response.data.choices[0].message.content
  } catch (err) {
    throw new Error(`AI call failed: ${err.response?.data?.error?.message || err.message}`)
  }

  const cleaned = raw.replace(/```json|```/g, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    parsed = {
      title: rawDescription.slice(0, 80),
      stepsToReproduce: ['See description below'],
      actualResult: raw.slice(0, 300),
      expectedResult: 'Correct behavior as per requirements',
      additionalContext: '',
    }
  }

  const blocks = []

  blocks.push(makeParagraph([makeText('Steps to Reproduce', true)]))
  const steps = Array.isArray(parsed.stepsToReproduce) ? parsed.stepsToReproduce : [parsed.stepsToReproduce]
  blocks.push(makeBulletList(steps))

  blocks.push(makeParagraph([makeText('Actual Result', true)]))
  blocks.push(makeParagraph([makeText(parsed.actualResult || 'See description')]))

  blocks.push(makeParagraph([makeText('Expected Result', true)]))
  blocks.push(makeParagraph([makeText(parsed.expectedResult || 'Correct behavior')]))

  if (parsed.additionalContext?.trim()) {
    blocks.push(makeParagraph([makeText('Additional Context', true)]))
    blocks.push(makeParagraph([makeText(parsed.additionalContext)]))
  }

  const adf = makeDoc(blocks)

  const preview = [
    `Steps to Reproduce:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
    `\nActual Result:\n  ${parsed.actualResult}`,
    `\nExpected Result:\n  ${parsed.expectedResult}`,
    parsed.additionalContext ? `\nAdditional Context:\n  ${parsed.additionalContext}` : '',
  ].filter(Boolean).join('\n')

  return {
    title: parsed.title || rawDescription.slice(0, 80),
    stepsToReproduce: steps,
    actualResult: parsed.actualResult,
    expectedResult: parsed.expectedResult,
    adf,
    preview,
  }
}
