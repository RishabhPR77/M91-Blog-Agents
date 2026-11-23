// The deploy script's helpers: where the token comes from and that it is never printed. No upload, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readToken, maskToken, bashPath, DEFAULT_NAME } from '../scripts/deploy.mjs'

test('the token: the environment first, else the file outside the repo, else none; it is masked in output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm91-blog-token-'))
  const file = join(dir, 'm91-blog.token')
  assert.equal(readToken({}, file), null)
  writeFileSync(file, 'emb_fake_file_token\n')
  assert.equal(readToken({}, file), 'emb_fake_file_token')
  assert.equal(readToken({ DEPLOY_TOKEN: ' emb_fake_env_token ' }, file), 'emb_fake_env_token')
  assert.equal(readToken({ EMBARKO_BLOG_DEPLOY_TOKEN: 'emb_fake_blog', DEPLOY_TOKEN: 'emb_other' }, file), 'emb_fake_blog')
  assert.equal(maskToken('Authorization: Bearer emb_fake_env_token ok', 'emb_fake_env_token'), 'Authorization: Bearer *** ok')
  assert.equal(DEFAULT_NAME, 'm91-blog')
  assert.equal(bashPath({ EMBARKO_BASH: '/x/bash' }), '/x/bash')
  assert.equal(bashPath({}, { platform: 'linux' }), 'bash')
})
