// One closing section: a "What should you do next?" next to "## What to do next" is merged into it, and the
// Markdown export is only the post (no front matter, no repeated description).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeNextSteps } from '../../src/writer/index.js'
import { buildMarkdownExport, blogOnly } from '../../src/export/markdown.js'

const POST = `# Title

Intro sentence.

## How does it work?

It works.

## What should you do next?

Pick one alert and route it to a phone.

\`\`\`md
## What should you do next?
\`\`\`

## What to do next

[Try M91](https://m91.msg91.com/start)
`

test('a second closing section is merged into "What to do next": its text first, the call to action last', () => {
  const { markdown, merged } = mergeNextSteps(POST)
  assert.deepEqual(merged, ['What should you do next?'])
  assert.equal((markdown.match(/^## What should you do next\?/gm) ?? []).length, 1, 'only the line inside the code block is left')
  // The removed section's text (with its code block) moves into "What to do next"; the link stays last.
  assert.match(markdown, /## How does it work\?\n\nIt works\.\n\n## What to do next\n\nPick one alert and route it to a phone\.\n\n```md\n## What should you do next\?\n```\n\n\[Try M91\]\(https:\/\/m91\.msg91\.com\/start\)\n$/)
})

test('"Next steps" and "Where to go from here" count too; a post without the CTA section, or without a duplicate, is unchanged', () => {
  for (const h of ['Next steps', "What's next?", 'Where to go from here']) {
    const md = `# T\n\n## ${h}\n\nDo this.\n\n## What to do next\n\n[Go](https://x.example)\n`
    assert.deepEqual(mergeNextSteps(md).merged, [h])
  }
  const noCta = '# T\n\n## Next steps\n\nDo this.\n'
  assert.equal(mergeNextSteps(noCta).markdown, noCta)
  const single = '# T\n\n## Why?\n\nBecause.\n\n## What to do next\n\n[Go](https://x.example)\n'
  assert.equal(mergeNextSteps(single).markdown, single)
})

test('the Markdown export is only the post: no front matter, no repeated description; title, intro, TL;DR, sections', () => {
  const draft = { version: 3, payload: { version: 3, title: 'Ask first', tldr: ['One.', 'Two.', 'Three.'], seo: { meta_description: 'An SEO line that is not part of the post.' },
    post_markdown: '# Ask first\n\nThe intro answers it.\n\n**TL;DR**\n\n- One.\n- Two.\n- Three.\n\n## Why ask?\n\nBecause.\n\n## What to do next\n\n[Try M91](https://m91.msg91.com/start)\n' } }
  const out = buildMarkdownExport({ draft, brief: { keyword: 'ask first', topic_group: 1 }, briefId: '261106-1000-ABCD', config: { m91: { ctaUrl: 'https://m91.msg91.com/start' } }, now: () => Date.parse('2026-11-06T10:00:00Z') })
  assert.equal(out.markdown, '# Ask first\n\nThe intro answers it.\n\n## TL;DR\n\n- One.\n- Two.\n- Three.\n\n## Why ask?\n\nBecause.\n\n## What to do next\n\n[Try M91](https://m91.msg91.com/start)\n')
  assert.doesNotMatch(out.markdown, /^---|SEO line|brief_id/m)
  assert.equal(out.front_matter.description, 'An SEO line that is not part of the post.', 'the metadata stays beside the file')
  // A file saved before this change loses its front matter when it is served.
  assert.equal(blogOnly('---\ntitle: "x"\nslug: "x"\n---\n\n# X\n\nBody.\n'), '# X\n\nBody.\n')
  assert.equal(blogOnly('# X\n\n---\n\nBody.\n'), '# X\n\n---\n\nBody.\n', 'a rule in the body is not front matter')
})
