// Atlassian Document Format builder
// All functions are pure — no imports, no side effects

export function makeDoc(blocks) {
  if (!Array.isArray(blocks)) throw new Error('makeDoc: blocks must be an array')
  return { type: 'doc', version: 1, content: blocks.filter(Boolean) }
}

export function makeParagraph(inlineNodes) {
  if (!Array.isArray(inlineNodes)) throw new Error('makeParagraph: inlineNodes must be an array')
  const filtered = inlineNodes.filter(Boolean)
  if (filtered.length === 0) return { type: 'paragraph', content: [{ type: 'text', text: ' ' }] }
  return { type: 'paragraph', content: filtered }
}

export function makeText(text, bold = false) {
  if (!text || typeof text !== 'string') return { type: 'text', text: ' ' }
  const node = { type: 'text', text }
  if (bold) node.marks = [{ type: 'strong' }]
  return node
}

export function makeLink(text, url) {
  return {
    type: 'text',
    text: text || url,
    marks: [{ type: 'link', attrs: { href: url } }]
  }
}

export function makeRule() {
  return { type: 'rule' }
}

export function makeBulletList(items) {
  return {
    type: 'bulletList',
    content: items.filter(Boolean).map(item => ({
      type: 'listItem',
      content: [makeParagraph([makeText(item)])]
    }))
  }
}

// Validator — call before sending to Jira
export function validateAdf(doc) {
  const blockTypes = ['paragraph', 'bulletList', 'orderedList', 'rule', 'heading', 'blockquote', 'codeBlock']
  const inlineTypes = ['text', 'emoji', 'hardBreak', 'mention', 'inlineCard']
  if (doc.type !== 'doc') throw new Error('ADF root must be type doc')
  for (const block of doc.content || []) {
    if (!blockTypes.includes(block.type)) throw new Error(`Invalid block type: ${block.type}`)
    for (const inline of block.content || []) {
      if (!inlineTypes.includes(inline.type)) throw new Error(`Invalid inline type: ${inline.type} inside ${block.type}`)
    }
  }
  return true
}
