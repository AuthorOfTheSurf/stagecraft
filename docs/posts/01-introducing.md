# Introducing the SDK (the rewrite)

*Rivet's Effect SDK launch post, rewritten the way we'd want to read it. Their version introduces the chat room in 551 lines across 8 files; here it is whole. Every API name is a placeholder.*

---

A Rivet actor is a small server with a name, durable state, and an inbox. You define one by saying what it remembers, what it announces, how it can fail, and what it does:

```typescript
import { actor } from "@rivetkit/????";

const Moderator = actor("Moderator", {
  errors: { BannedWords: {} as { reason: string } },
  handle: {
    Review: async ({ text }: { text: string }, { fail }) => {
      if (text.includes("spam")) throw fail.BannedWords({ reason: "no spam allowed" });
    },
  },
});

type Member = { name: string; joinedAt: number };
type ChatMessage = { sender: string; text: string; at: number };

const ChatRoom = actor("ChatRoom", {
  state: { name: "", members: [] as Member[], messages: [] as ChatMessage[] },
  events: {
    memberJoined: {} as { member: Member },
    newMessage: {} as ChatMessage,
  },
  errors: { MemberNotInRoom: {} as { name: string } },
  handle: {
    Join: async ({ name }: { name: string }, { state, emit, self }) => {
      const member = { name, joinedAt: Date.now() };
      state.members.push(member);
      emit.memberJoined({ member });
      self.after(1000).SendMessage({ sender: "Admin", text: `Welcome, ${name}!` });
      return { memberCount: state.members.length };
    },

    SendMessage: async (m: { sender: string; text: string }, { state, actors, emit, fail }) => {
      if (!state.members.some((x) => x.name === m.sender))
        throw fail.MemberNotInRoom({ name: m.sender });
      await actors(Moderator).getOrCreate("main").Review({ text: m.text });
      const message = { sender: m.sender, text: m.text, at: Date.now() };
      state.messages.push(message);
      emit.newMessage(message);
    },

    GetHistory: async (_: void, { state }) => state.messages,
  },
});
```

Calling it looks like calling it:

```typescript
const room = ChatRoom.client().getOrCreate("lobby");

const { memberCount } = await room.Join({ name: "Alice" });
await room.SendMessage({ sender: "Alice", text: "hello!" });

try {
  await room.SendMessage({ sender: "Mallory", text: "let me in" });
} catch (e) {
  if (room.is.MemberNotInRoom(e)) console.warn(`${e.name} is not a member`);
}
```

That's the whole app. What you just used without being asked to learn it:

- **Durable state.** `state` is a persisted document. It survives sleep, restarts, and deploys. Mutate the draft in your handler; it commits when the handler succeeds and is discarded when it throws — a failed action can't half-write.
- **One message at a time.** Handlers on one actor instance never interleave. No locks, no lost updates.
- **Typed errors, end to end.** Declare them once; throw them with `fail.X()`; catch them anywhere — including across actors: the Moderator's `BannedWords` surfaces at Alice's original call site, typed.
- **Scheduling.** `self.after(1000).SendMessage(...)` is a durable timer, not a `setTimeout`.
- **Events.** `emit.newMessage(...)` broadcasts to connected clients; the `events` block is the wire contract.

Underneath, this is the Effect SDK — every handler runs as an Effect with typed error channels and tracing spans, and when you need that power you can drop to it directly. You just don't need it to say hello.

*Part 2: what happens when your code has the bug you didn't declare.*
