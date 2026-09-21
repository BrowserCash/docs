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
  : path.startsWith('/v1/browser/pools') ? 'Pools'
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
  'POST /v1/browser/pools': 'Create a pool',
  'GET /v1/browser/pools': 'List pools',
  'GET /v1/browser/pools/{poolId}': 'Get a pool',
  'PATCH /v1/browser/pools/{poolId}': 'Update a pool',
  'DELETE /v1/browser/pools/{poolId}': 'Delete a pool',
  'POST /v1/browser/pools/{poolId}/acquire': 'Acquire a browser',
  'POST /v1/browser/pools/{poolId}/release': 'Release a browser',
  'POST /v1/browser/pools/{poolId}/flush': 'Flush warm browsers',
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
    description: 'The session has ended ("Cannot update a terminal session") or the note is longer than 256 characters.',
    content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } } },
  }
}
// What the prose promises but the generator leaves out, so generated clients see it too.
const errorSchema = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] }
const list = doc.paths['/v1/browser/sessions']?.get
if (list) {
  for (const p of list.parameters || []) {
    if (p.name === 'page') { p.schema = { ...p.schema, default: 1 }; delete p.schema.exclusiveMinimum; p.schema.minimum = 1 }
    if (p.name === 'pageSize') { p.schema = { ...p.schema, default: 20, maximum: 100 }; delete p.schema.exclusiveMinimum; p.schema.minimum = 1; p.description = 'The number of sessions per page, 1 to 100. Larger values are clamped to 100.' }
    if (p.name === 'status') p.description = 'Only sessions in exactly this status.'
  }
  if (!list.responses['400']) list.responses['400'] = { description: 'The status filter is not one of starting, active, completed, error.', content: { 'application/json': { schema: errorSchema } } }
  const item = list.responses['200']?.content?.['application/json']?.schema?.properties?.sessions?.items
  if (item?.properties?.bandwidthBytes && !item.required.includes('bandwidthBytes')) item.required.push('bandwidthBytes')
}
const getSession = create?.get?.responses?.['200']?.content?.['application/json']?.schema
if (getSession?.properties?.bandwidthBytes) {
  if (!getSession.required.includes('bandwidthBytes')) getSession.required.push('bandwidthBytes')
  getSession.properties.bandwidthBytes.nullable = true
  getSession.properties.bandwidthBytes.description = 'Bandwidth used by the session in bytes: null while it runs, the metered total once it has ended (final by the time a stop call returns).'
}
const walk = (node, fn) => { if (Array.isArray(node)) node.forEach((n) => walk(n, fn)); else if (node && typeof node === 'object') { fn(node); Object.values(node).forEach((v) => walk(v, fn)) } }
walk(doc, (n) => { if (n.properties?.sessionId?.type === 'string') n.properties.sessionId.description = 'The session id: an opaque string; do not validate its format.' })
const create503 = create?.post?.responses?.['503']
if (create503) {
  create503.headers = { 'Retry-After': { description: 'Seconds to wait before trying again (2).', schema: { type: 'integer' } } }
  const code = create503.content?.['application/json']?.schema?.properties?.code
  if (code) { code.enum = ['browser_capacity_unavailable']; code.description = 'Machine-readable cause; present when no browser capacity is available.' }
}
// Pools, verified live 2026-09-20: create answers 201 (the generator lists 200 as well); the browser template is
// validated when browsers start, not on create; acquire needs a JSON body; the 409s have fixed messages.
const pools = doc.paths['/v1/browser/pools']
const poolCreate = pools?.post
if (poolCreate) {
  if (poolCreate.responses['201'] && poolCreate.responses['200']) delete poolCreate.responses['200']
  const props = poolCreate.requestBody?.content?.['application/json']?.schema?.properties
  if (props) {
    props.name.description = 'Unique in the workspace, 1 to 64 characters.'
    props.size.description = 'Browsers to keep ready. All pools together may keep 30 warm per account.'
    props.browser.description = 'The create options every browser in the pool starts with (same fields as POST /v1/browser/session, without type, duration and browserCheck). Validated like a create body (an unsupported country is a 400). Responses echo the template with the resolved timezone and a redacted proxyUrl.'
    props.leaseTimeoutSeconds.description = 'How long an acquired browser may be held, in seconds (30 to 86400, default 900). The session is stopped when the lease expires.'
    props.maxReadyAgeSeconds.description = 'How long a browser may wait ready before it is replaced with a fresh one, in seconds (30 to 86400, default 3600).'
  }
  poolCreate.responses['409'].description = 'A pool with that name already exists, or the size would exceed the warm-browser cap of the account ("Pool capacity 32 exceeds your pool limit of 30").'
}
const poolPatch = doc.paths['/v1/browser/pools/{poolId}']?.patch
if (poolPatch) {
  const props = poolPatch.requestBody?.content?.['application/json']?.schema?.properties
  if (props?.browser) props.browser.description = 'Replaces the browser template as a whole and rebuilds the warm browsers from it. Leave it out to keep the current template.'
  if (props?.paused) props.paused.description = 'true stops the warm browsers and refuses acquires; false warms them again.'
}
const poolDelete = doc.paths['/v1/browser/pools/{poolId}']?.delete
if (poolDelete) {
  for (const p of poolDelete.parameters || []) if (p.name === 'force') p.description = 'Pass true to stop leased browsers too. Without it a pool with active leases answers 409 ("Pool has active leases; pass force=true to stop them").'
  poolDelete.responses['409'].description = 'The pool has active leases and force was not passed.'
}
const acquire = doc.paths['/v1/browser/pools/{poolId}/acquire']?.post
if (acquire) {
  const body = acquire.requestBody?.content?.['application/json']?.schema
  if (body?.properties?.waitMs) { body.properties.waitMs.default = 0; body.properties.waitMs.description = 'How long to wait for a browser to become ready when none is, in milliseconds (0 to 30000). Send {} for no wait; the body is required.' }
  acquire.responses['409'].description = 'No browser became ready within waitMs ("No browser is currently ready in this pool"), or the pool is paused.'
  acquire.description = 'Take a ready browser. From here on the session belongs to the workspace like any other; the pool warms a replacement. Its createdAt is when the browser was warmed.'
}
const release = doc.paths['/v1/browser/pools/{poolId}/release']?.post
if (release) {
  release.description = 'End a leased browser. The session is stopped; the answer carries status "ended". Idempotent: releasing the same lease again answers the same body.'
  release.responses['404'].description = 'Unknown pool, or a lease that does not belong to it ("Pool lease not found").'
}
const flush = doc.paths['/v1/browser/pools/{poolId}/flush']?.post
if (flush) flush.description = 'Stop every ready browser and warm fresh ones. Leased browsers are not touched. Answers how many were stopped.'
if (doc.components?.securitySchemes?.Bearer) doc.components.securitySchemes.Bearer.description = 'A workspace API key from Settings → API keys in the dashboard (https://app.driver.dev), sent as a bearer token.'
doc.externalDocs = { url: 'https://docs.driver.dev', description: 'Driver documentation' }
if (doc.info) doc.info.contact = { name: 'Driver support', email: 'alex@driver.dev' }

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
