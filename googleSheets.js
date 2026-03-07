import { google } from 'googleapis'
import dayjs from 'dayjs'

function getAuth(config) {
  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    'http://localhost:3141'
  )
  oauth2Client.setCredentials({ refresh_token: config.googleRefreshToken })
  return oauth2Client
}

const HEADERS = [
  'Bug ID', 'Bug Type', 'Reported By', 'Reporting Date', 'JIRA ID',
  'Title', 'Current Status', 'Environment', 'Priority', 'RCA', 'Assignee', 'Remarks',
]

function formatDate(dateStr) {
  return dayjs(dateStr).format('DD-MMM-YYYY')
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return { red: r, green: g, blue: b }
}

export async function createBugSheet({ config, epicKey, epicSummary, bugs, jiraBaseUrl }) {
  const auth = getAuth(config)
  const sheets = google.sheets({ version: 'v4', auth })
  const today = dayjs().format('DD-MMM-YYYY')

  const spreadsheetTitle = `Bug Sheet — ${epicSummary} — ${today}`
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: spreadsheetTitle },
      sheets: [{
        properties: {
          title: `${epicKey} — Bug Sheet`,
          gridProperties: { rowCount: Math.max(bugs.length + 10, 50), columnCount: 12 },
        }
      }]
    }
  })

  const spreadsheetId = createRes.data.spreadsheetId
  const sheetId = createRes.data.sheets[0].properties.sheetId

  // Write all data (column E URL will be overwritten with formula via batchUpdate below)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${epicKey} — Bug Sheet'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        HEADERS,
        ...bugs.map((bug, idx) => [
          `BUG_ID_${idx + 1}`,
          'Bug',
          bug.reporter || '',
          formatDate(bug.created),
          bug.url,
          bug.summary || '',
          bug.status || '',
          bug.environment || 'UAT',
          bug.priority || '',
          '',
          bug.assignee || 'Unassigned',
          '',
        ])
      ]
    }
  })

  const requests = []

  // Header row — bold, dark blue background, white text
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 },
      cell: {
        userEnteredFormat: {
          backgroundColor: hexToRgb('#1565C0'),
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: 'CENTER',
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    }
  })

  // Alternating row colors for data rows
  bugs.forEach((_, idx) => {
    const rowIndex = idx + 1
    const bgColor = idx % 2 === 0 ? hexToRgb('#FFFFFF') : hexToRgb('#E3F2FD')
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: { backgroundColor: bgColor } },
        fields: 'userEnteredFormat.backgroundColor',
      }
    })
  })

  // Hyperlink formulas for column E (JIRA ID)
  bugs.forEach((bug, idx) => {
    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: idx + 1, endRowIndex: idx + 2, startColumnIndex: 4, endColumnIndex: 5 },
        rows: [{ values: [{ userEnteredValue: { formulaValue: `=HYPERLINK("${bug.url}","${bug.key}")` } }] }],
        fields: 'userEnteredValue',
      }
    })
  })

  // Freeze header row
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount',
    }
  })

  // Auto-resize all columns
  requests.push({
    autoResizeDimensions: {
      dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 12 }
    }
  })

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return { sheetUrl, spreadsheetId }
}

export async function shareSheetPublicly(config, spreadsheetId) {
  const auth = getAuth(config)
  const drive = google.drive({ version: 'v3', auth })
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { role: 'reader', type: 'anyone' },
  })
}
