/**
 * The chat room from Rivet's Effect SDK launch post, rewritten on the
 * proposed layer (layer.ts) — the game's player chat, one room per venue.
 * Messages live in actor state (the durable JSON store every actor already
 * has); SQLite stays a deliberate graft-on for later, per the design doc.
 */
import { actor } from "../src/index.ts";

export type Member = { name: string; joinedAt: number };
export type ChatMessage = { sender: string; text: string; at: number };

export const Moderator = actor("Moderator", {
  state: {},
  errors: { BannedWords: {} as { reason: string } },
  handle: {
    Review: async ({ text }: { text: string }, { fail }) => {
      if (text.includes("spam")) throw fail.BannedWords({ reason: "no spam allowed" });
    },
  },
});

export const ChatRoom = actor("ChatRoom", {
  state: {
    name: "",
    members: [] as Member[],
    messages: [] as ChatMessage[],
  },
  events: {
    memberJoined: {} as { member: Member },
    memberLeft: {} as { name: string },
    newMessage: {} as ChatMessage,
  },
  errors: {
    MemberNotInRoom: {} as { name: string },
  },
  handle: {
    Initialize: async ({ name }: { name: string }, { state }) => {
      if (!state.name) state.name = name;
    },

    Join: async ({ name }: { name: string }, { state, emit, self }) => {
      const member = { name, joinedAt: Date.now() };
      state.members.push(member);
      emit.memberJoined({ member });
      self.after(250).SendMessage({ sender: "Admin", text: `Welcome, ${name}!` });
      return { memberCount: state.members.length };
    },

    Leave: async ({ name }: { name: string }, { state, emit, fail }) => {
      if (!state.members.some((m) => m.name === name))
        throw fail.MemberNotInRoom({ name });
      state.members = state.members.filter((m) => m.name !== name);
      emit.memberLeft({ name });
    },

    SendMessage: async (
      m: { sender: string; text: string },
      { state, actors, emit, fail },
    ) => {
      const isAdmin = m.sender === "Admin";
      if (!isAdmin && !state.members.some((x) => x.name === m.sender))
        throw fail.MemberNotInRoom({ name: m.sender });
      await actors(Moderator).getOrCreate("main").Review({ text: m.text });
      const message = { sender: m.sender, text: m.text, at: Date.now() };
      state.messages.push(message);
      emit.newMessage(message);
    },

    GetHistory: async (_: void, { state }) => state.messages,
  },
});
