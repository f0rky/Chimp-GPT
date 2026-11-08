'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const simpleFlowStub = require('../helpers/simpleFlowStubs');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const stub = simpleFlowStub(request, parent);
  if (stub !== undefined) return stub;
  if (request === './KnowledgeFlow' && parent?.filename.includes('SimpleChimpGPTFlow'))
    return class {};
  return originalLoad.call(this, request, parent, isMain);
};
const SimpleChimpGPTFlow = require('../../src/conversation/flow/SimpleChimpGPTFlow');
Module._load = originalLoad;
const msg = (
  content,
  { user = 'u1', channel = 'c1', guild = 'g1', thread = channel, id = content } = {}
) => ({
  id,
  content,
  channelId: channel,
  guildId: guild,
  author: { id: user },
  channel: { id: thread },
  attachments: [],
});
const response = value => ({ choices: [{ message: { content: value } }] });

test('specialist time response is committed as a complete turn for follow-up', async () => {
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async r => {
          requests.push(r);
          return response(`Answer ${requests.length}`);
        },
      },
    },
  };
  const flow = new SimpleChimpGPTFlow(client, null, {
    enableKnowledge: false,
    timeLookup: async () => '09:30 Tokyo',
  });
  await flow.processMessage(msg('What time is it in Tokyo?'));
  await flow.processMessage(msg('and that?'));
  assert.deepEqual(
    requests[1].messages.filter(x => x.role !== 'system').map(x => [x.role, x.content]),
    [
      ['user', 'What time is it in Tokyo?'],
      ['assistant', 'Answer 1'],
      ['user', 'and that?'],
    ]
  );
});
test('completed history is isolated by user, channel, guild, and thread; clones are defensive', async () => {
  const requests = [];
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async r => {
            requests.push(r);
            return response('ok');
          },
        },
      },
    },
    null,
    { enableKnowledge: false }
  );
  await flow.processMessage(msg('old'));
  for (const opts of [{ user: 'u2' }, { channel: 'c2' }, { guild: 'g2' }, { thread: 't2' }])
    await flow.processMessage(msg('fresh', opts));
  for (let i = 1; i < 5; i++)
    assert.equal(JSON.stringify(requests[i].messages).includes('old'), false);
  const copy = flow.getConversationMessages(msg('later'));
  copy[0].content = 'changed';
  assert.equal(flow.getConversationMessages(msg('later'))[0].content, 'old');
});
test('turn processing is serialized per scope without cross-user blocking or lost first turns', async () => {
  const seen = [];
  let release;
  const gate = new Promise(r => (release = r));
  let calls = 0;
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async r => {
            seen.push(r);
            if (++calls === 1) await gate;
            return response('ok');
          },
        },
      },
    },
    null,
    { enableKnowledge: false }
  );
  const a = flow.processMessage(msg('first'));
  const b = flow.processMessage(msg('second'));
  const c = flow.processMessage(msg('other', { user: 'u2' }));
  await c;
  release();
  await Promise.all([a, b]);
  assert.equal(
    seen.some(
      r =>
        r.messages.some(x => x.content === 'first') && r.messages.some(x => x.content === 'second')
    ),
    true
  );
  assert.equal(
    seen
      .find(r => r.messages.some(x => x.content === 'other'))
      .messages.some(x => x.content === 'first'),
    false
  );
});
test('clear validates, queues behind in-flight turn, and clears exact scope asynchronously', async () => {
  let release;
  const gate = new Promise(r => (release = r));
  let count = 0;
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async () => {
            if (++count === 1) await gate;
            return response('ok');
          },
        },
      },
    },
    null,
    { enableKnowledge: false }
  );
  const first = flow.processMessage(msg('before'));
  const clearing = flow.clearConversation({
    userId: 'u1',
    channelId: 'c1',
    guildId: 'g1',
    threadId: 'c1',
  });
  const later = flow.processMessage(msg('after'));
  release();
  await first;
  assert.equal(await clearing, true);
  await later;
  assert.deepEqual(
    flow.getConversationMessages(msg('probe')).map(x => x.content),
    ['after', 'ok']
  );
  assert.equal(await flow.clearConversation({ userId: '', channelId: 'c1', guildId: 'g1' }), false);
  assert.equal(
    await flow.clearConversation({ userId: 'nobody', channelId: 'c1', guildId: 'g1' }),
    false
  );
});
test('trim retains only complete newest user/assistant pairs and failed turns do not commit', async () => {
  let fail = false;
  const seen = [];
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async r => {
            seen.push(r);
            if (fail) throw Error('offline');
            return response('ok');
          },
        },
      },
    },
    null,
    { enableKnowledge: false, maxConversationLength: 3 }
  );
  for (const s of ['one', 'two', 'three']) await flow.processMessage(msg(s));
  assert.deepEqual(
    flow.getConversationMessages(msg('x')).map(x => x.content),
    ['three', 'ok']
  );
  fail = true;
  const result = await flow.processMessage(msg('broken'));
  assert.equal(result.success, false);
  assert.deepEqual(
    flow.getConversationMessages(msg('x')).map(x => x.content),
    ['three', 'ok']
  );
});
test('image result commits only a short safe summary, never bytes, data URLs, or attachment URLs', async () => {
  const secret = 'data:image/png;base64,SECRETBYTES';
  const flow = new SimpleChimpGPTFlow(
    { chat: { completions: { create: async () => response('ok') } } },
    null,
    {
      enableKnowledge: false,
      imageService: {
        generateImage: async () => ({
          success: true,
          images: [
            {
              b64_json: Buffer.from('SECRETBYTES').toString('base64'),
              url: 'https://private.invalid/image',
            },
          ],
        }),
      },
    }
  );
  await flow.processMessage(msg('draw a red fox'));
  const history = flow.getConversationMessages(msg('next'));
  assert.equal(history.length, 2);
  assert.match(history[0].content, /draw a red fox/);
  assert.match(history[1].content, /generated image/i);
  assert.doesNotMatch(JSON.stringify(history), /SECRETBYTES|data:image|private\.invalid|base64/);
});
test('plain conversation continuity sends only prior completed turns plus current message', async () => {
  const requests = [];
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async r => {
            requests.push(r);
            return response('reply');
          },
        },
      },
    },
    null,
    { enableKnowledge: false }
  );
  await flow.processMessage(msg('hello'));
  await flow.processMessage(msg('follow up'));
  assert.deepEqual(
    requests[1].messages.slice(1).map(x => x.content),
    ['hello', 'reply', 'follow up']
  );
});

test('specialist time payload carries prior completed conversation', async () => {
  const requests = [];
  const flow = new SimpleChimpGPTFlow(
    {
      chat: {
        completions: {
          create: async r => {
            requests.push(r);
            return response('time reply');
          },
        },
      },
    },
    null,
    { enableKnowledge: false, timeLookup: async () => 'fixture time' }
  );
  await flow.processMessage(msg('My name is Ada'));
  await flow.processMessage(msg('What time is it in Tokyo?'));
  assert.match(requests.at(-1).messages[1].content, /My name is Ada/);
});

test('stored specialist summaries are bounded and image links are not retained', async () => {
  const flow = new SimpleChimpGPTFlow(
    { chat: { completions: { create: async () => response('unused') } } },
    null,
    { enableKnowledge: false }
  );
  flow.flow.run = async () => ({ success: true, type: 'knowledge', response: 'x'.repeat(20000) });
  await flow.processMessage(msg('lookup fixture'));
  assert.equal(flow.getConversationMessages(msg('probe'))[1].content.length, 4000);
  flow.flow.run = async () => ({
    success: true,
    type: 'image',
    originalPrompt: 'fox https://private.invalid/secret data:image/png;base64,SECRET',
  });
  await flow.processMessage(msg('draw fox'));
  assert.doesNotMatch(
    flow.getConversationMessages(msg('probe')).at(-1).content,
    /private.invalid|SECRET|data:image/
  );
});

test('missing scope identifiers fail closed for processing and clear', async () => {
  const flow = new SimpleChimpGPTFlow(
    { chat: { completions: { create: async () => response('ok') } } },
    null,
    { enableKnowledge: false }
  );
  assert.equal(
    (await flow.processMessage({ content: 'no author', channel: { id: 'c' } })).success,
    false
  );
  assert.equal(await flow.clearConversation({ channelId: 'c' }), false);
});
