/**
 * Conversation Quality Assurance Script
 *
 * Runs 5 scripted test scenarios against a live server and verifies structural
 * quality of responses. Tests pass in stub mode (no OpenAI key) because they
 * check format, not content.
 *
 * Usage:
 *   ts-node scripts/qa_conversation.ts [http://localhost:3000] [api-key]
 *
 * Exit code 0 = all checks passed, 1 = one or more failures.
 */

import axios from 'axios';

const BASE = process.argv[2] || 'http://localhost:3000';
const API_KEY = process.argv[3] || 'dev-key-1';

const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

// ── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function noCitations(text: string) {
  return !/\[#\d+\]/.test(text);
}

async function startConversation(profile?: object): Promise<{ id: string; openingMessage?: string }> {
  const res = await axios.post(`${BASE}/conversation/start`, { profile }, { headers });
  return res.data;
}

async function sendMessage(threadId: string, query: string): Promise<{ answer: string; citations: any[]; model: string }> {
  const res = await axios.post(`${BASE}/conversation/${threadId}/send`, { query, temperature: 0.7 }, { headers });
  return res.data;
}

// ── Test Scenarios ───────────────────────────────────────────────────────────

async function scenario1_firstTimeUser() {
  console.log('\n📋 Scenario 1: First-time anonymous user');
  const { id, openingMessage } = await startConversation();
  check('opening message present', !!openingMessage);
  check('opening has no citation markers', noCitations(openingMessage || ''));
  check('opening asks for name or invites sharing', /name|share|leadership|what'?s|what is/i.test(openingMessage || ''));

  // First reply
  const reply = await sendMessage(id, 'My name is Alex');
  check('reply is non-empty', !!reply.answer && reply.answer.length > 10);
  check('reply has no citation markers', noCitations(reply.answer));
  check('citations array present', Array.isArray(reply.citations));
}

async function scenario2_emotionalDistress() {
  console.log('\n📋 Scenario 2: Emotional distress signal');
  const { id } = await startConversation({ firstName: 'Jordan' });

  const reply = await sendMessage(id, "I'm overwhelmed and exhausted. I feel like I'm failing as a leader and I don't know what to do anymore.");
  check('reply is non-empty', !!reply.answer && reply.answer.length > 10);
  check('reply has no citation markers', noCitations(reply.answer));
  // In stub mode, we can't test content quality — just structural
  check('citations array present', Array.isArray(reply.citations));
  // Make sure the stub doesn't echo the raw distress
  check('reply is not just an echo', reply.answer.toLowerCase() !== "i'm overwhelmed and exhausted.");
}

async function scenario3_executiveWithGoals() {
  console.log('\n📋 Scenario 3: Executive with goals and deadlines');
  const { id, openingMessage } = await startConversation({
    firstName: 'Patricia',
    role: 'Chief Operating Officer',
    industry: 'Healthcare',
    currentChallenge: 'scaling leadership across a 500-person organization',
    goals: ['build a leadership pipeline', 'improve cross-functional collaboration']
  });
  check('opening present', !!openingMessage);
  check('opening references challenge or name', /patricia|scaling|leadership|organization/i.test(openingMessage || ''));
  check('opening has no citation markers', noCitations(openingMessage || ''));

  const reply = await sendMessage(id, 'My biggest fear is that we move too fast and lose the culture we built.');
  check('reply is non-empty', !!reply.answer && reply.answer.length > 10);
  check('reply has no citation markers', noCitations(reply.answer));
}

async function scenario4_maxwellFramework() {
  console.log('\n📋 Scenario 4: Question about a Maxwell framework');
  const { id } = await startConversation({ firstName: 'Marcus' });

  const reply = await sendMessage(id, 'Can you explain the 5 levels of leadership and how I apply them as a middle manager?');
  check('reply is non-empty', !!reply.answer && reply.answer.length > 10);
  check('reply has no citation markers', noCitations(reply.answer));
  check('citations array present', Array.isArray(reply.citations));
}

async function scenario5_vagueQuestion() {
  console.log('\n📋 Scenario 5: Vague open-ended question');
  const { id } = await startConversation();

  const reply = await sendMessage(id, 'I want to be better.');
  check('reply is non-empty', !!reply.answer && reply.answer.length > 10);
  check('reply has no citation markers', noCitations(reply.answer));
  // Response should ideally probe — but in stub mode we just verify structure
  check('reply is not error JSON', !reply.answer.startsWith('{'));
}

async function scenario6_openingVariants() {
  console.log('\n📋 Scenario 6: Opening message personalization variants');

  const { openingMessage: noProfile } = await startConversation();
  check('anonymous opening is generic Maxwell intro', /john maxwell|first name/i.test(noProfile || ''));

  const { openingMessage: nameOnly } = await startConversation({ firstName: 'Sam' });
  check('name-only opening addresses user by name', /sam/i.test(nameOnly || ''));

  const { openingMessage: fullProfile } = await startConversation({
    firstName: 'Dana',
    currentChallenge: 'managing remote teams across time zones'
  });
  check('full profile opening references challenge', /remote|time zone|dana/i.test(fullProfile || ''));
  check('all openings have no citation markers', [noProfile, nameOnly, fullProfile].every(m => noCitations(m || '')));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Maxwell Coaching QA — ${BASE}`);
  console.log('─'.repeat(50));

  // Verify server is reachable
  try {
    const health = await axios.get(`${BASE}/health`, { headers });
    const { embedding, vector, voiceConfigured } = health.data;
    console.log(`\nServer: OK  embedding=${embedding}  vector=${vector}  voice=${voiceConfigured ? 'configured' : 'not configured'}`);
    if (embedding === 'local') {
      console.log('⚠️  Using local hash embedder — retrieval is structural only. Add OPENAI_API_KEY for semantic quality.');
    }
  } catch {
    console.error('❌ Server unreachable at', BASE);
    process.exit(1);
  }

  await scenario1_firstTimeUser();
  await scenario2_emotionalDistress();
  await scenario3_executiveWithGoals();
  await scenario4_maxwellFramework();
  await scenario5_vagueQuestion();
  await scenario6_openingVariants();

  console.log('\n' + '─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

  if (failed > 0) {
    console.log('\n❌ QA FAILED — address the failures above before shipping.');
    process.exit(1);
  } else {
    console.log('\n✅ QA PASSED — all structural checks green.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err?.response?.data || err.message || err);
  process.exit(1);
});
