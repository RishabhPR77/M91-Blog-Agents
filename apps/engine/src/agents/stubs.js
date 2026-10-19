// Phase 1 placeholder agents: fixed, schema-shaped outputs, no AI calls (tests use them).
// The Reviewer stub is gone (Phase 5): tests inject a mock reviewer instead (test/helpers.js).
// Each takes the pipeline context and returns { output, model, ms }.

/** Up to n real sentences (6+ words) from a post's prose lines, for stub feedback quotes. */
export function sampleSentences(markdown, n) {
  const lines = String(markdown).split('\n').filter((l) => l.trim() && !/^\s*(#|\||```|[-*+]\s|\d+[.)]\s|\*\*TL;DR)/.test(l))
  const sentences = lines.flatMap((l) => l.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 6)
  return sentences.slice(0, n)
}

import { log } from '../util/log.js'

export const STUB_MODEL = 'stub'

export const stubAgents = {
  async scout() {
    return {
      model: STUB_MODEL,
      output: {
        leads: [
          {
            kind: 'question_cluster',
            topic: 'When should an AI agent call a human?',
            topic_group: 'human-in-the-loop',
            questions: ['How do I escalate an AI decision to a person?', 'Can software ring my phone for an approval?'],
            sources: []
          }
        ]
      }
    }
  },

  // Phase 2: receives the real ScoutResult (or the stub leads above) and logs what it got.
  async strategist({ leads, briefId }) {
    if (leads?.mode === 'research') {
      log.info('strategist stub received ScoutResult', {
        briefId,
        reused: leads.reused,
        top_clusters: leads.top_clusters,
        counts: leads.counts,
        story_ids: leads.story_ids,
        tutorial_ids: leads.tutorial_ids,
        style_profile_id: leads.style_profile_id,
        warnings: leads.warnings?.length ?? 0
      })
    }
    const lead = leads?.top_clusters?.[0] ?? leads?.leads?.[0]
    return {
      model: STUB_MODEL,
      output: {
        topic: lead?.main_question ?? lead?.topic ?? 'Placeholder topic',
        topic_group: lead?.topic_group ?? 'general',
        angle: 'Placeholder angle',
        audience: 'Developers building AI agents',
        outline: ['Problem', 'How M91 helps', 'Example', 'Next steps'],
        tone: 'friendly-teacher',
        target_words: 900
      }
    }
  },

  // Phase 3: receives the real brief and logs what it got (the Writer is built in Phase 4).
  async writer({ brief, version, briefId }) {
    if (brief?.brief_id) {
      log.info('writer stub received brief', {
        briefId, version, brief_version: brief.brief_version, post_type: brief.post_type, title: brief.titles?.[0],
        keyword: brief.keyword, sections: brief.outline?.length, tone: brief.tone?.source, sources: brief.sources?.length
      })
    }
    return {
      model: STUB_MODEL,
      output: {
        title: `${brief?.titles?.[0] ?? brief?.topic ?? 'Placeholder'} (draft v${version})`,
        post_markdown: '# Placeholder\n\nThis is a stub draft written in Phase 1.',
        context: { version, words: 9 }
      }
    }
  },

  // Phase 5: a fixed promo pack (tests), shaped like runPromo's output.
  async promo() {
    const u = '{{POST_URL}}'
    return {
      model: STUB_MODEL,
      output: {
        status: 'ok', record_id: null, problems: [], repairs_used: 0, warnings: [],
        pack: {
          linkedin_post: `Software can ring a phone when it needs a yes or no.
${u}`,
          x_thread: ['A risky step can wait for a person.', 'The phone rings until someone answers.', `Read more: ${u}`],
          newsletter_blurb: `How a phone call can approve a risky step. ${u}`,
          video_script: [{ on_screen_text: 'Risky step?', voiceover: 'Pause it.' }, { on_screen_text: 'Phone rings', voiceover: 'A person answers.' }, { on_screen_text: `Read: ${u}`, voiceover: 'Read the post.' }],
          community_question: 'When should an agent ask a person first?'
        }
      }
    }
  }
}
