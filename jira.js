import axios from 'axios'
import fs from 'fs'
import path from 'path'
import dayjs from 'dayjs'
import FormData from 'form-data'
import { makeDoc, makeParagraph, makeText, makeLink } from './adfBuilder.js'

export async function getEpicInfo(baseUrl, auth, epicKey) {
  const response = await axios.get(
    `${baseUrl}/rest/api/3/issue/${epicKey}?fields=summary,issuetype`,
    { headers: { 'Authorization': 'Basic ' + auth } }
  )

  const { data } = response

  if (data.fields.issuetype.name !== 'Epic') {
    throw new Error(`${epicKey} is not an Epic`)
  }

  return { key: epicKey, summary: data.fields.summary }
}

export async function fetchIssueDetails(baseUrl, auth, issueKeyOrUrl) {
  let key
  if (issueKeyOrUrl.includes('/browse/')) {
    const match = issueKeyOrUrl.match(/\/browse\/([A-Z]+-\d+)/)
    key = match?.[1]
  } else {
    key = issueKeyOrUrl.trim().toUpperCase()
  }

  let response
  try {
    response = await axios.get(
      `${baseUrl}/rest/api/3/issue/${key}?fields=summary,description,issuetype,status`,
      { headers: { 'Authorization': 'Basic ' + auth } }
    )
  } catch (err) {
    if (err.response?.status === 404) throw new Error(`Issue ${key} not found`)
    if (err.response?.status === 401) throw new Error('Jira authentication failed — run jira setup')
    throw new Error(`Failed to fetch ${key}: ${err.response?.data?.errorMessages?.join(', ') || err.message}`)
  }

  const { data } = response
  const fields = data.fields
  const descriptionText = fields.description ? adfToPlainText(fields.description) : ''

  return {
    key,
    summary: fields.summary,
    descriptionText,
    issueType: fields.issuetype.name,
    status: fields.status.name,
    url: baseUrl + '/browse/' + key
  }
}

function adfToPlainText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (['doc','paragraph','blockquote','heading'].includes(node.type)) {
    return (node.content || []).map(adfToPlainText).join('') + '\n'
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content || []).map(adfToPlainText).join('')
  }
  if (node.type === 'listItem') {
    return '- ' + (node.content || []).map(adfToPlainText).join('')
  }
  return (node.content || []).map(adfToPlainText).join('')
}

export async function createTask(baseUrl, auth, { epicKey, summary, description, label, startDate, dueDate, assigneeAccountId }) {
  const safeStartDate = startDate || dayjs().format('YYYY-MM-DD')

  const fields = {
    project: { key: epicKey.split('-')[0] },
    parent: { key: epicKey },
    issuetype: { name: 'Task' },
    summary,
    description,
    assignee: { accountId: assigneeAccountId },
    duedate: dueDate,
    customfield_10015: safeStartDate,
  }
  if (label) fields.labels = [label]

  const headers = { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' }
  let response
  try {
    response = await axios.post(
      `${baseUrl}/rest/api/3/issue`,
      { fields },
      { headers }
    )
  } catch (err) {
    const errorBody = err.response?.data
    const msgs = errorBody?.errorMessages || []
    const errs = Object.values(errorBody?.errors || {})
    throw new Error('Task creation failed: ' + [...msgs, ...errs].join(', '))
  }

  const issueKey = response.data.key
  return {
    issueKey,
    issueUrl: baseUrl + '/browse/' + issueKey,
  }
}

export async function transitionToDone(baseUrl, auth, issueKey) {
  let transitions
  try {
    const res = await axios.get(
      `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      { headers: { 'Authorization': 'Basic ' + auth } }
    )
    transitions = res.data.transitions
  } catch (err) {
    throw new Error(`Could not fetch transitions for ${issueKey}: ${err.response?.data?.errorMessages?.join(', ') || err.message}`)
  }

  const doneTransition = transitions.find(t =>
    t.name.toLowerCase() === 'done' ||
    t.to?.name?.toLowerCase() === 'done' ||
    t.name.toLowerCase().includes('done') ||
    t.name.toLowerCase().includes('complete')
  )

  if (!doneTransition) {
    console.warn(`\u26a0 No "Done" transition found for ${issueKey}. Available: ${transitions.map(t => t.name).join(', ')}`)
    console.warn(`  Set status manually at: ${baseUrl}/browse/${issueKey}`)
    return false
  }

  try {
    await axios.post(
      `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      { transition: { id: doneTransition.id } },
      { headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' } }
    )
    return true
  } catch (err) {
    throw new Error(`Transition to Done failed: ${err.response?.data?.errorMessages?.join(', ') || err.message}`)
  }
}

export async function attachFileToIssue(baseUrl, auth, issueKey, filePath) {
  const form = new FormData()
  form.append('file', fs.createReadStream(filePath), path.basename(filePath))

  await axios.post(
    `${baseUrl}/rest/api/3/issue/${issueKey}/attachments`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Basic ' + auth,
        'X-Atlassian-Token': 'no-check',
      }
    }
  )

  return {
    fileName: path.basename(filePath),
    size: fs.statSync(filePath).size
  }
}

export async function addCommentWithLink(baseUrl, auth, issueKey, linkText, linkUrl) {
  const body = makeDoc([
    makeParagraph([makeText(linkText + ': ', true), makeLink(linkUrl, linkUrl)])
  ])

  await axios.post(
    `${baseUrl}/rest/api/3/issue/${issueKey}/comment`,
    { body },
    { headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' } }
  )
}

// ── Delete issue ─────────────────────────────────────────────────────────────

export async function deleteIssue(baseUrl, auth, issueKeyOrUrl) {
  let key = issueKeyOrUrl.trim()
  if (key.includes('/browse/')) {
    key = key.match(/\/browse\/([A-Z]+-\d+)/)?.[1]
    if (!key) throw new Error(`Could not extract issue key from URL: ${issueKeyOrUrl}`)
  }
  key = key.toUpperCase()

  try {
    await axios.delete(
      `${baseUrl}/rest/api/3/issue/${key}`,
      { headers: { 'Authorization': 'Basic ' + auth } }
    )
  } catch (err) {
    if (err.response?.status === 403) {
      throw new Error(`Permission denied: deleting ${key} requires admin approval. Contact your Jira project admin to grant delete permissions.`)
    }
    if (err.response?.status === 404) {
      throw new Error(`Issue ${key} not found — it may have already been deleted`)
    }
    const msgs = err.response?.data?.errorMessages || [err.message]
    throw new Error(`Delete failed: ${msgs.join(', ')}`)
  }

  return { key }
}

// ── Bug creation supporting functions ────────────────────────────────────────

export async function searchProjects(baseUrl, auth, query) {
  try {
    const res = await axios.get(
      `${baseUrl}/rest/api/3/project/search?query=${encodeURIComponent(query)}&maxResults=10`,
      { headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' } }
    )
    return (res.data.values || []).map(p => ({
      key: p.key,
      name: p.name,
      id: p.id,
    }))
  } catch (err) {
    if (err.response?.status === 401) throw new Error('Jira auth failed — run jira setup')
    throw new Error(`Project search failed: ${err.response?.data?.errorMessages?.join(', ') || err.message}`)
  }
}

export async function searchEpicsInProject(baseUrl, auth, projectKey, query) {
  const jql = query.trim()
    ? `project = "${projectKey}" AND issuetype = Epic AND summary ~ "${query}" ORDER BY created DESC`
    : `project = "${projectKey}" AND issuetype = Epic ORDER BY created DESC`

  try {
    const res = await axios.post(
      `${baseUrl}/rest/api/3/search/jql`,
      { jql, fields: ['summary', 'status'], maxResults: 10 },
      { headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    )
    return (res.data.issues || []).map(i => ({
      key: i.key,
      summary: i.fields.summary,
    }))
  } catch (err) {
    throw new Error(`Epic search failed: ${err.response?.data?.errorMessages?.join(', ') || err.message}`)
  }
}

export async function searchUsers(baseUrl, auth, query) {
  try {
    const res = await axios.get(
      `${baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=8`,
      { headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' } }
    )
    return (res.data || []).map(u => ({
      accountId: u.accountId,
      displayName: u.displayName,
      emailAddress: u.emailAddress || '',
    }))
  } catch (err) {
    throw new Error(`User search failed: ${err.response?.data?.errorMessages?.join(', ') || err.message}`)
  }
}

// ── Bug sheet supporting functions ───────────────────────────────────────────

function extractEnvironment(descriptionText) {
  if (!descriptionText) return 'UAT'
  const lower = descriptionText.toLowerCase()
  if (lower.includes('production') || lower.includes(' prod ') || lower.includes('prod:')) return 'Production'
  if (lower.includes('staging')) return 'Staging'
  if (lower.includes(' dev ') || lower.includes('development') || lower.includes('dev env')) return 'Dev'
  if (lower.includes('qa env') || lower.includes('qa environment')) return 'QA'
  if (lower.includes('uat')) return 'UAT'
  return 'UAT'
}

export async function fetchBugsInEpic(baseUrl, auth, epicKey) {
  const jqlOptions = [
    `"Epic Link" = ${epicKey} AND issuetype = Bug ORDER BY created ASC`,
    `cf[10014] = ${epicKey} AND issuetype = Bug ORDER BY created ASC`,
    `issueFunction in issuesOf("project = ${epicKey.split('-')[0]} AND key = ${epicKey}") AND issuetype = Bug ORDER BY created ASC`,
  ]

  let issues = []
  let fetchSucceeded = false

  for (const jql of jqlOptions) {
    try {
      const res = await axios.get(
        `${baseUrl}/rest/api/3/search`,
        {
          params: {
            jql,
            fields: 'summary,status,priority,assignee,reporter,created,description,issuetype',
            maxResults: 100,
          },
          headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' }
        }
      )
      issues = res.data.issues || []
      fetchSucceeded = true
      break
    } catch (err) {
      if (err.response?.status === 400) continue
      const msgs = err.response?.data?.errorMessages || [err.message]
      throw new Error(`Failed to fetch bugs: ${msgs.join(', ')}`)
    }
  }

  if (!fetchSucceeded) {
    throw new Error(`Could not query bugs for epic ${epicKey} — all JQL variants failed`)
  }

  return issues.map(issue => {
    const fields = issue.fields
    const descriptionText = adfToPlainText(fields.description)
    return {
      key: issue.key,
      summary: fields.summary || '',
      status: fields.status?.name || 'Unknown',
      priority: fields.priority?.name || 'None',
      assignee: fields.assignee?.displayName || 'Unassigned',
      reporter: fields.reporter?.displayName || 'Unknown',
      created: fields.created ? fields.created.slice(0, 10) : '',
      description: descriptionText,
      url: `${baseUrl}/browse/${issue.key}`,
      environment: extractEnvironment(descriptionText),
    }
  })
}

export async function createBug(baseUrl, auth, {
  projectKey,
  epicKey,
  summary,
  description,
  priority,
  assigneeAccountId,
  issueOwnerAccountId,
  environment,
  label,
}) {
  // Use priority value directly — maps to Jira priority names (P1, P2, P3 or Highest, High, Medium)
  const jiraPriority = priority || 'P3'

  // Verify the project has Bug issue type
  let issueTypeName = 'Bug'
  try {
    const metaRes = await axios.get(
      `${baseUrl}/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
      { headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' } }
    )
    const types = metaRes.data.issueTypes || metaRes.data.values || metaRes.data || []
    const hasBug = types.some(t => t.name.toLowerCase() === 'bug')
    if (!hasBug) {
      const available = types.map(t => t.name).join(', ')
      throw new Error(`Project ${projectKey} does not have a "Bug" issue type. Available types: ${available}. Choose a different project that supports bugs.`)
    }
  } catch (err) {
    if (err.message.includes('does not have')) throw err
    // If meta lookup fails, try Bug anyway
  }

  const fields = {
    project: { key: projectKey },
    issuetype: { name: issueTypeName },
    summary,
    description,
    priority: { name: jiraPriority },
  }

  if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId }
  if (issueOwnerAccountId) fields.customfield_10097 = { accountId: issueOwnerAccountId }
  if (environment) fields.customfield_10148 = { value: environment }
  if (label) fields.labels = [label]
  if (epicKey) fields.parent = { key: epicKey }

  let response
  const headers = { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' }

  // Try with parent (team-managed), then customfield_10014 (next-gen), then customfield_10008 (classic)
  const epicStrategies = epicKey
    ? [
        () => { fields.parent = { key: epicKey }; delete fields.customfield_10014; delete fields.customfield_10008 },
        () => { delete fields.parent; fields.customfield_10014 = epicKey; delete fields.customfield_10008 },
        () => { delete fields.parent; delete fields.customfield_10014; fields.customfield_10008 = epicKey },
      ]
    : [() => {}]

  for (let i = 0; i < epicStrategies.length; i++) {
    epicStrategies[i]()
    try {
      response = await axios.post(`${baseUrl}/rest/api/3/issue`, { fields }, { headers })
      break
    } catch (err) {
      const fieldErrors = JSON.stringify(err.response?.data?.errors || {})
      const isEpicFieldError = epicKey && (
        fieldErrors.includes('parent') || fieldErrors.includes('customfield_10014') || fieldErrors.includes('customfield_10008')
      )
      if (isEpicFieldError && i < epicStrategies.length - 1) continue
      const msgs = err.response?.data?.errorMessages || [err.message]
      const errs = Object.values(err.response?.data?.errors || {})
      throw new Error('Bug creation failed: ' + [...msgs, ...errs].join(', '))
    }
  }

  return {
    issueKey: response.data.key,
    issueUrl: baseUrl + '/browse/' + response.data.key,
  }
}
