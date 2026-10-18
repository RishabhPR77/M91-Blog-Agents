# How agent approval works with a phone call

Agent approval means your software stops and asks a person before a risky step. M91 rings that person's phone and sends the answer back.

**TL;DR**
- Agent approval pauses a risky action until a person says yes or no.
- M91 rings the phone until someone answers.
- Your software reads the answer and then acts.

## What is agent approval?

Agent approval is a pause before a risky action. The agent waits for a person to decide.

An agent is a program that takes steps on its own. Some steps are risky, like sending money.

A pause keeps a person in charge. You can read how [one framework handles it](https://github.com/example/agents/issues/1).

## Why does the phone need to ring?

A ringing phone gets attention fast. A chat message can wait unread for hours.

M91 rings every phone in a channel until someone answers, as the [M91 docs](https://m91.msg91.com/llms.txt) explain. One person takes the call and owns the decision. That person can approve or reject.

## What happens after someone answers?

The answer goes back to your software. Your software then decides what to do.

1. Your software asks for approval.
2. The phone rings.
3. A person approves or rejects.
4. Your software continues.

**If you approve**, the software runs the step.

**If you reject**, the software skips it.

M91 only carries the answer. Your software does the work.

## How do I start?

Start with one small, risky action. Add an approval step before it.

Keep the question short and clear. Say what will happen if the person says yes.

Test it with your own phone first. Then add it to more steps.

## What to do next

Try it on one action today. [Try M91: send your first alert in a few minutes.](https://m91.msg91.com/signup)
