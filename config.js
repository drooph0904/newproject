import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'
import { execSync } from 'child_process'
import axios from 'axios'
import { input, password, confirm, select } from '@inquirer/prompts'
import chalk from 'chalk'

const CONFIG_DIR = path.join(os.homedir(), '.qa-jira')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

function openBrowser(url) {
  try {
    const platform = process.platform
    if (platform === 'darwin') execSync(`open "${url}"`)
    else if (platform === 'win32') execSync(`start "" "${url}"`)
    else execSync(`xdg-open "${url}"`)
    return true
  } catch {
    return false
  }
}

export async function setup() {
  console.log(chalk.cyan('\n  jira setup — Let\'s get you configured\n'))

  const jiraBaseUrl = 'https://applicate.atlassian.net'
  console.log(chalk.dim('  Jira workspace: ') + chalk.cyan(jiraBaseUrl))

  // Step 1: Jira email
  console.log(chalk.dim('\nStep 1 of 4: Jira email'))
  const jiraEmail = (await input({ message: 'Your Jira account email:' })).trim()

  // Step 2: Jira API token
  console.log(chalk.dim('\nStep 2 of 4: Jira API token'))
  console.log(chalk.white('  You need a Jira API token. Here\'s how to get one:'))
  console.log(chalk.dim('  1. Go to: ') + chalk.cyan('https://id.atlassian.com/manage-profile/security/api-tokens'))
  console.log(chalk.dim('  2. Click "Create API token"'))
  console.log(chalk.dim('  3. Give it a name like "qa-jira-cli"'))
  console.log(chalk.dim('  4. Copy the token and paste it below\n'))

  const openedJira = openBrowser('https://id.atlassian.com/manage-profile/security/api-tokens')
  if (openedJira) {
    console.log(chalk.green('  \u2714 Opened Atlassian token page in your browser'))
  } else {
    console.log(chalk.yellow('  \u26a0 Could not open browser. Visit the URL above manually.'))
  }

  const jiraApiToken = await password({ message: 'Paste your Jira API token:', mask: '*' })

  // Validate Jira credentials
  process.stdout.write(chalk.dim('  Validating Jira credentials...\r'))
  let accountId, displayName
  try {
    const res = await axios.get(`${jiraBaseUrl}/rest/api/3/myself`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64'),
        'Accept': 'application/json'
      }
    })
    accountId = res.data.accountId
    displayName = res.data.displayName
    console.log(chalk.green('  \u2714 Jira authenticated — Hello, ') + chalk.white(displayName))
  } catch (err) {
    const status = err.response?.status
    if (status === 401) {
      console.log(chalk.red('  \u2717 Invalid credentials. Check your email and API token.'))
    } else {
      console.log(chalk.red(`  \u2717 Jira error ${status}: ${err.message}`))
    }
    const retry = await confirm({ message: 'Retry Jira setup?', default: true })
    if (retry) return setup()
    process.exit(1)
  }

  // Step 3: AI provider
  console.log(chalk.dim('\nStep 3 of 4: AI provider for description generation'))

  const aiProvider = await select({
    message: 'Which AI provider do you want to use?',
    choices: [
      { name: 'OpenRouter (free models available — recommended)', value: 'openrouter' },
      { name: 'MiniMax (direct API)', value: 'minimax' },
      { name: 'Other OpenAI-compatible API', value: 'other' },
    ]
  })

  let aiBaseUrl, aiKeyUrl, aiKeyInstructions, aiModel

  if (aiProvider === 'openrouter') {
    aiBaseUrl = 'https://openrouter.ai/api/v1'
    aiKeyUrl = 'https://openrouter.ai/keys'
    aiModel = 'nvidia/nemotron-3-nano-30b-a3b:free'
    aiKeyInstructions = [
      '1. Sign up free at openrouter.ai (no credit card needed for free models)',
      '2. Go to openrouter.ai/keys',
      '3. Click "Create Key"',
      '4. Copy and paste the key below',
    ]
  } else if (aiProvider === 'minimax') {
    aiBaseUrl = 'https://api.minimax.chat/v1'
    aiKeyUrl = 'https://www.minimaxi.com/user-center/basic-information/interface-key'
    aiModel = 'abab6.5s-chat'
    aiKeyInstructions = [
      '1. Log in at minimaxi.com',
      '2. Go to User Center \u2192 Interface Key',
      '3. Create a new key and copy it below',
    ]
  } else {
    aiBaseUrl = await input({ message: 'AI base URL (OpenAI-compatible, e.g. https://api.example.com/v1):' })
    aiKeyUrl = null
    aiModel = await input({ message: 'Model name:' })
    aiKeyInstructions = ['Get your API key from your provider dashboard']
  }

  // Step 4: AI API key
  console.log(chalk.dim('\nStep 4 of 4: AI API key'))
  console.log(chalk.white(`  Getting your ${aiProvider} API key:`))
  aiKeyInstructions.forEach(line => console.log(chalk.dim('  ' + line)))
  console.log()

  if (aiKeyUrl) {
    const openedAi = openBrowser(aiKeyUrl)
    if (openedAi) {
      console.log(chalk.green(`  \u2714 Opened ${aiProvider} key page in your browser`))
    } else {
      console.log(chalk.yellow(`  \u26a0 Visit manually: ${aiKeyUrl}`))
    }
  }

  const aiApiKey = await password({ message: `Paste your ${aiProvider} API key:`, mask: '*' })

  console.log(chalk.dim(`\n  Default model: ${aiModel}`))
  const confirmedModel = await input({ message: 'AI model name (press Enter for default):', default: aiModel })

  // Validate AI key
  process.stdout.write(chalk.dim('  Validating AI key...\r'))
  try {
    await axios.post(
      aiBaseUrl + '/chat/completions',
      {
        model: confirmedModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok" only.' }]
      },
      { headers: { 'Authorization': 'Bearer ' + aiApiKey, 'Content-Type': 'application/json' } }
    )
    console.log(chalk.green('  \u2714 AI key validated'))
  } catch (err) {
    const status = err.response?.status
    if (status === 401 || status === 403) {
      console.log(chalk.red('  \u2717 Invalid AI API key.'))
    } else if (status === 404) {
      console.log(chalk.yellow('  \u26a0 Model not found — key may be valid but check model name'))
    } else {
      console.log(chalk.yellow(`  \u26a0 Could not validate AI key (${status || err.message}) — saving anyway`))
    }
  }

  // Save config
  const config = {
    jiraBaseUrl,
    jiraEmail,
    jiraApiToken,
    accountId,
    displayName,
    aiBaseUrl,
    aiApiKey,
    aiModel: confirmedModel,
  }

  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  fs.chmodSync(CONFIG_PATH, 0o600)

  console.log('\n' + chalk.green('  \u2714 Config saved to ~/.qa-jira/config.json'))
  console.log(chalk.dim('  Run: ') + chalk.cyan('jira task create') + chalk.dim(' to log your first task.\n'))

  const wantGoogle = await select({
    message: 'Also set up Google Sheets integration? (for jira mk bugsheet)',
    choices: [
      { name: 'Yes — set up now', value: 'yes' },
      { name: 'No — I will run jira setup --google later', value: 'no' },
    ]
  })
  if (wantGoogle === 'yes') await setupGoogle()
}

export async function setupGoogle() {
  console.log(chalk.cyan('\n  jira setup --google — Google Sheets integration\n'))
  console.log(chalk.white('  You need to create OAuth 2.0 credentials in Google Cloud Console.\n'))
  console.log(chalk.white('  Follow these steps:\n'))
  console.log(chalk.dim('  1. Go to: APIs & Services → Credentials'))
  console.log(chalk.dim('  2. Click "Create Credentials" → "OAuth client ID"'))
  console.log(chalk.dim('  3. If prompted, configure the OAuth consent screen first (External, your email)'))
  console.log(chalk.dim('  4. Application type: Desktop app'))
  console.log(chalk.dim('  5. Name: jira-cli (or anything)'))
  console.log(chalk.dim('  6. Click Create — copy the Client ID and Client Secret below\n'))

  const openedBrowser = openBrowser('https://console.cloud.google.com/apis/credentials?project=cli-tool-489505')
  if (openedBrowser) {
    console.log(chalk.green('  ✔ Opened Google Cloud Console in your browser'))
  } else {
    console.log(chalk.yellow('  ⚠ Visit manually: https://console.cloud.google.com/apis/credentials'))
  }

  const clientId = (await input({ message: '  Google OAuth Client ID:' })).trim()
  const clientSecret = (await input({ message: '  Google OAuth Client Secret:' })).trim()

  const { google } = await import('googleapis')
  const REDIRECT_PORT = 3141
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${REDIRECT_PORT}`)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })

  console.log(chalk.cyan('\n  Opening Google sign-in in your browser...'))
  console.log(chalk.dim('  Sign in and grant access — the terminal will continue automatically.\n'))
  openBrowser(authUrl)

  // Wait for OAuth callback on localhost
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const params = new URL(req.url, `http://localhost:${REDIRECT_PORT}`).searchParams
      const code = params.get('code')
      const error = params.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="font-family:sans-serif;padding:40px;background:#f0f4f8"><h2 style="color:#1565C0">✅ Authorised!</h2><p>You can close this tab and return to your terminal.</p></body></html>')
      server.close()
      if (error) reject(new Error(`Auth denied: ${error}`))
      else resolve(code)
    })
    server.listen(REDIRECT_PORT)
    server.on('error', reject)
    setTimeout(() => { server.close(); reject(new Error('Timed out waiting for Google auth (2 min)')) }, 120000)
  })

  process.stdout.write(chalk.dim('  Exchanging auth code for tokens...\r'))
  const { tokens } = await oauth2Client.getToken(code)

  if (!tokens.refresh_token) {
    console.log(chalk.red('\n  ✗ No refresh token received.'))
    console.log(chalk.dim('  Go to myaccount.google.com/permissions, revoke access for this app, then run jira setup --google again.'))
    return
  }

  const existing = await getConfig()
  const updated = {
    ...existing,
    googleClientId: clientId,
    googleClientSecret: clientSecret,
    googleRefreshToken: tokens.refresh_token,
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2))
  fs.chmodSync(CONFIG_PATH, 0o600)

  console.log(chalk.green('\n  ✔ Google Sheets configured — you are signed in'))
  console.log(chalk.dim('  Run: ') + chalk.cyan('jira mk bugsheet') + '\n')
}

export async function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(chalk.yellow('\u26a0') + ' Run jira setup first')
    process.exit(1)
  }
  const configData = fs.readFileSync(CONFIG_PATH, 'utf-8')
  return JSON.parse(configData)
}
