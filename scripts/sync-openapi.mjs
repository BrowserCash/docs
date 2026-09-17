// Pulls the live OpenAPI document that Scalar renders at https://api.driver.dev/scalar (ground truth for what
// exists) and writes api-reference/openapi.json with the two things Mintlify needs that the source omits:
// a servers entry and tags for grouping. Run `npm run sync` before publishing; never edit the JSON by hand.
import fs from 'node:fs'

const SOURCE = process.env.OPENAPI_URL || 'https://api.driver.dev/doc'
const doc = await fetch(SOURCE).then((r) => { if (!r.ok) throw new Error(`${SOURCE} → ${r.status}`); return r.json() })

doc.servers = [{ url: 'https://api.driver.dev', description: 'Production' }]
doc.info = { ...doc.info, title: 'Driver API', description: doc.info?.description || 'Hosted Chrome sessions over CDP, plus scrape and search.' }

const tagFor = (path) => path.startsWith('/v1/browser/session') ? 'Sessions'
  : path.startsWith('/v1/browser/profile') ? 'Profiles'
  : path.startsWith('/v1/browser/extensions') ? 'Extensions'
  : path.startsWith('/v1/account') ? 'Account'
  : path.startsWith('/v1/teracrawl') ? 'Scrape and search'
  : 'Other'
const summaries = {
  'POST /v1/browser/session': 'Create a session',
  'GET /v1/browser/session': 'Get a session',
  'PATCH /v1/browser/session': 'Update a session note',
  'DELETE /v1/browser/session': 'Stop a session',
  'GET /v1/browser/sessions': 'List sessions',
  'GET /v1/browser/profiles': 'List profiles',
  'DELETE /v1/browser/profile': 'Delete a profile',
  'GET /v1/account/balance': 'Get balance',
  'GET /v1/account/billing': 'Get billing details',
  'POST /v1/teracrawl/scrape': 'Scrape a page',
  'POST /v1/teracrawl/search': 'Search the web',
  'POST /v1/browser/extensions': 'Upload an extension',
  'GET /v1/browser/extensions': 'List extensions',
  'GET /v1/browser/extensions/{extensionId}': 'Get an extension',
  'PUT /v1/browser/extensions/{extensionId}': 'Update an extension',
  'DELETE /v1/browser/extensions/{extensionId}': 'Delete an extension',
}
const tags = new Set()
for (const [path, ops] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
    const tag = tagFor(path)
    tags.add(tag)
    op.tags = [tag]
    op.summary ||= summaries[`${method.toUpperCase()} ${path}`] || op.summary
    op.security ||= [{ Bearer: [] }]
  }
}
doc.tags = [...tags].map((name) => ({ name }))

// OpenAPI 3.0 schemas allow `example`, not an `examples` array; the source uses the latter. Keep the first one.
const fixExamples = (node) => {
  if (Array.isArray(node)) return node.forEach(fixExamples)
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.examples) && (node.type || node.properties || node.items || node.$ref)) {
    if (node.example === undefined && node.examples.length) node.example = node.examples[0]
    delete node.examples
  }
  for (const v of Object.values(node)) fixExamples(v)
}
fixExamples(doc)
fs.mkdirSync('api-reference', { recursive: true })
fs.writeFileSync('api-reference/openapi.json', JSON.stringify(doc, null, 2) + '\n')
console.log(`wrote api-reference/openapi.json from ${SOURCE}: ${Object.keys(doc.paths).length} paths`)
