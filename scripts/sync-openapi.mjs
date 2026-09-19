// Pulls the live OpenAPI document that Scalar renders at https://api.driver.dev/scalar (ground truth for what
// exists) and writes api-reference/openapi.json with the two things Mintlify needs that the source omits:
// a servers entry and tags for grouping. Run `npm run sync` before publishing; never edit the JSON by hand.
import fs from 'node:fs'

const SOURCE = process.env.OPENAPI_URL || 'https://api.driver.dev/doc'
const doc = await fetch(SOURCE).then((r) => { if (!r.ok) throw new Error(`${SOURCE} → ${r.status}`); return r.json() })

doc.servers = [{ url: 'https://api.driver.dev', description: 'Production' }]
doc.info = { ...doc.info, title: 'Driver API', description: doc.info?.description || 'Hosted Chrome sessions over CDP, plus scrape and search.' }

// Deprecated surface is not documented: the teracrawl endpoints and the consumer_distributed browser type.
for (const path of Object.keys(doc.paths)) if (path.startsWith('/v1/teracrawl')) delete doc.paths[path]
const dropDeprecatedType = (node) => {
  if (Array.isArray(node)) return node.forEach(dropDeprecatedType)
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.enum)) node.enum = node.enum.filter((v) => v !== 'consumer_distributed')
  for (const v of Object.values(node)) dropDeprecatedType(v)
}
dropDeprecatedType(doc)

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

// Corrections to what the generator emits, verified against the gateway and session service source:
// - duration: zod's .positive().min(60) renders as minimum 60 + exclusiveMinimum true, but 60 is accepted.
// - balance_cents can go negative (the wallet may be overdrawn), so the minimum is wrong.
// - PATCH answers 400 for a session that has ended; the generator does not declare it.
// - the security description, external docs and contact name the old brand.
const create = doc.paths['/v1/browser/session']
const duration = create?.post?.requestBody?.content?.['application/json']?.schema?.properties?.duration
if (duration) delete duration.exclusiveMinimum
const balanceCents = doc.paths['/v1/account/balance']?.get?.responses?.['200']?.content?.['application/json']?.schema?.properties?.balance?.properties?.balance_cents
if (balanceCents) { delete balanceCents.minimum; balanceCents.description = `${balanceCents.description || 'Balance in cents.'} Can be negative when usage exceeds prepaid credit.` }
if (create?.patch && !create.patch.responses['400']) {
  create.patch.responses['400'] = {
    description: 'The session has ended ("Cannot update a completed or errored session") or the note is longer than 256 characters.',
    content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } } },
  }
}
if (doc.components?.securitySchemes?.Bearer) doc.components.securitySchemes.Bearer.description = 'A workspace API key from Settings → API keys in the dashboard (https://app.driver.dev), sent as a bearer token.'
doc.externalDocs = { url: 'https://docs.driver.dev', description: 'Driver documentation' }
if (doc.info) doc.info.contact = { name: 'Driver support', email: 'support@driver.dev' }

// The source document names internal systems. Readers get product language instead. Ordered: phrases first, then words.
const SCRUB = [
  [/ consumer_distributed is the legacy route\./g, ''],
  [/ consumer_distributed is the legacy distributed-browser route\./g, ''],
  [/ and rejected for consumer_distributed sessions/g, ''],
  [/, or 'consumer_distributed'/g, ''],
  [/, 'hosted_privacy', or 'consumer_distributed'/g, ", or 'hosted_privacy'"],
  [/hosted, hosted_stealth, and hosted_privacy launch on Rio; hosted_stealth enables conservative Mirage Stealth and hosted_privacy enables the preserved aggressive Stealth policy\./g, 'hosted, hosted_stealth, and hosted_privacy are hosted browsers; hosted_stealth applies the conservative stealth policy and hosted_privacy the aggressive one.'],
  [/hosted uses Mirage natively, hosted_stealth uses conservative Stealth, and hosted_privacy uses the preserved aggressive Stealth policy\./g, 'hosted is the native browser, hosted_stealth applies the conservative stealth policy, and hosted_privacy the aggressive one.'],
  [/Rio\/Mirage virtual display size/g, 'Virtual display size'],
  [/ Only supported by Rio-backed hosted types\./g, ''],
  [/ Supported by all Rio-backed hosted types\.?/g, ''],
  [/Rio stores persistent profiles as portable Mirage plaintext archives\./g, 'Persistent profiles are kept between sessions.'],
  [/so Mirage uses its built-in en-US default/g, 'so the browser uses its built-in en-US default'],
  [/primary language supported by Mirage/g, 'primary language the browser supports'],
  [/Rio selected a machine but the browser did not become CDP-ready before the startup deadline\./g, 'A machine was selected but the browser did not become CDP-ready before the startup deadline.'],
  [/Rio is unavailable, so a complete account session response cannot be produced\./g, 'The session service is unavailable.'],
  [/Rio session service unavailable/g, 'Session service unavailable'],
  [/Lisa or its billing provider could not return billing details\./g, 'Billing details could not be returned.'],
  [/wss:\/\/[a-z0-9.-]+\.tera\.space\//g, 'wss://sessions.driver.dev/'],
  [/[a-z0-9.-]+\.tera\.space/g, 'driver.dev'],
  [/Cloaked outer browser-window size/g, 'Outer browser-window size'],
  [/ and targets managed proxy geography where the provider supports regional targeting/g, ' and, where Driver runs a managed network there, routes the session through that region'],
  [/Forwarded to node-side launch when supported\.?/g, 'Opened right after launch.'],
  [/\/v1\/consumer\//g, '/v1/session/'],
  [/ \(browser or agent, they work interchangeably\)/g, ''],
  [/APIGW/g, 'Driver'],
  [/\bRio\b/g, 'Driver'],
  [/\bMirage\b/g, 'Chrome'],
  [/\bLisa\b/g, 'the session service'],
]
const scrub = (node) => {
  if (Array.isArray(node)) return node.map(scrub)
  if (node && typeof node === 'object') { for (const k of Object.keys(node)) node[k] = scrub(node[k]); return node }
  if (typeof node === 'string') return SCRUB.reduce((acc, [re, to]) => acc.replace(re, to), node)
  return node
}
scrub(doc)
fs.mkdirSync('api-reference', { recursive: true })
fs.writeFileSync('api-reference/openapi.json', JSON.stringify(doc, null, 2) + '\n')
console.log(`wrote api-reference/openapi.json from ${SOURCE}: ${Object.keys(doc.paths).length} paths`)
