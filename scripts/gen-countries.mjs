// Generates docs/options/countries.mdx from the API's locale catalog: for every supported country, the
// IANA timezones and BCP-47 languages that `timezone` and `language` accept on create. The two JSON files
// under scripts/data/ are copies of the gateway's catalog (src/data/iana-timezones-by-country.json and
// lpcab-country-map.json); refresh them when the gateway's change, then run `npm run countries`.
import fs from 'node:fs'

const tz = JSON.parse(fs.readFileSync('scripts/data/iana-timezones-by-country.json', 'utf8'))
const lang = JSON.parse(fs.readFileSync('scripts/data/lpcab-country-map.json', 'utf8'))
const names = new Intl.DisplayNames(['en'], { type: 'region' })

const codes = Object.keys(tz).filter((c) => tz[c]?.length && lang[c]?.length).sort()
const rows = codes.map((c) => {
  let name = c
  try { name = names.of(c) || c } catch {}
  const languages = c === 'US' ? ['en-US'] : lang[c]
  return `| \`${c}\` | ${name} | ${tz[c].map((t) => `\`${t}\``).join(', ')} | ${languages.map((l) => `\`${l}\``).join(', ')} |`
})

const page = `---
title: "Countries"
description: "Every country you can pass on create, with the timezones and languages it accepts. Generated from the API's locale catalog."
---

\`country\` accepts any of the ${codes.length} codes below. \`timezone\` must be one of that country's timezones and \`language\` one of its languages, or the request is a \`400\`. Leave both out and you get the first-listed timezone (or a managed-network region where Driver has one) and the country's primary language. US sessions are always \`en-US\`. [Location](/docs/options/location) covers how the three stay coherent.

Machine availability varies by country. No free machine in a country is a \`503\`.

| Code | Country | Timezones | Languages |
|---|---|---|---|
${rows.join('\n')}
`
fs.writeFileSync('docs/options/countries.mdx', page)
console.log(`wrote docs/options/countries.mdx: ${codes.length} countries`)
