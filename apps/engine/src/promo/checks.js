// Code checks for a promo pack (Phase 5 brief, D1). Pure: pack in, problems out.

import { BANNED_PHRASES, FIRST_PERSON_PHRASES, findPhrases } from '../checks/phrases.js'
import { POST_URL } from './prompts.js'

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi
const EMOJI_RE = /\p{Extended_Pictographic}/gu
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean)

/** Every text in the pack with a label, in order. */
export function packTexts(pack) {
  return [
    ['linkedin_post', pack.linkedin_post],
    ...(pack.x_thread ?? []).map((t, i) => [`x_thread[${i + 1}]`, t]),
    ['newsletter_blurb', pack.newsletter_blurb],
    ...(pack.video_script ?? []).flatMap((s, i) => [[`video_script[${i + 1}].on_screen_text`, s.on_screen_text], [`video_script[${i + 1}].voiceover`, s.voiceover]]),
    ['community_question', pack.community_question]
  ].map(([label, text]) => [label, String(text ?? '')])
}

/** Problems with a pack ([] when it passes every check). */
export function promoProblems(pack, { linkedinMax, xMax }) {
  const p = []
  const li = String(pack.linkedin_post ?? '')
  if (li.length > linkedinMax) p.push(`linkedin_post is ${li.length} characters; the limit is ${linkedinMax}`)
  if (!li.trimEnd().endsWith(POST_URL)) p.push(`linkedin_post must end with ${POST_URL}`)

  const x = pack.x_thread ?? []
  if (x.length < 3 || x.length > 6) p.push(`x_thread has ${x.length} posts; it needs 3 to 6`)
  x.forEach((t, i) => { if (t.length > xMax) p.push(`x_thread[${i + 1}] is ${t.length} characters; the limit is ${xMax}`) })
  if (x.length && !x[x.length - 1].includes(POST_URL)) p.push(`the last x_thread post must contain ${POST_URL}`)

  const nl = String(pack.newsletter_blurb ?? '')
  if (words(nl).length > 60) p.push(`newsletter_blurb is ${words(nl).length} words; the limit is 60`)
  if (!nl.trimEnd().endsWith(POST_URL)) p.push(`newsletter_blurb must end with ${POST_URL}`)

  const v = pack.video_script ?? []
  if (v.length < 3 || v.length > 5) p.push(`video_script has ${v.length} scenes; it needs 3 to 5`)
  v.forEach((s, i) => {
    if (words(s.on_screen_text).length > 8) p.push(`video_script[${i + 1}].on_screen_text is ${words(s.on_screen_text).length} words; the limit is 8`)
    if (words(s.voiceover).length > 25) p.push(`video_script[${i + 1}].voiceover is ${words(s.voiceover).length} words; the limit is 25`)
  })
  if (v.length && !String(v[v.length - 1].on_screen_text).includes(POST_URL)) p.push(`the last video scene's on_screen_text must point to ${POST_URL}`)

  if (String(pack.community_question ?? '').includes(POST_URL)) p.push('community_question must not contain a link')

  for (const [label, text] of packTexts(pack)) {
    const urls = text.match(URL_RE) ?? []
    if (urls.length) p.push(`${label} has a URL other than ${POST_URL}: ${urls[0]}`)
    const hashtags = text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []
    if (hashtags.length > 3) p.push(`${label} has ${hashtags.length} hashtags; at most 3`)
    const emojis = text.match(EMOJI_RE) ?? []
    if (emojis.length > 1) p.push(`${label} has ${emojis.length} emojis; at most 1`)
    const banned = findPhrases(text, BANNED_PHRASES)
    if (banned.length) p.push(`${label} uses banned phrase(s): ${banned.join(', ')}`)
    const fp = findPhrases(text, FIRST_PERSON_PHRASES)
    if (fp.length) p.push(`${label} makes an experience claim: ${fp.join(', ')}`)
  }
  return p
}
