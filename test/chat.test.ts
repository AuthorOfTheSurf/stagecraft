/**
 * The launch-post chat room's user-visible behavior, proven on the v0
 * layer: join + scheduled welcome, membership gating, actor-to-actor
 * moderation with the callee's typed error surfacing at the caller,
 * typed-guard error handling, and reject-leaves-state-untouched.
 */
import { afterAll, expect, test } from "bun:test";
import { ChatRoom, Moderator } from "../examples/chat.ts";
import { engine, release, retain } from "./test-harness.ts";

retain();
afterAll(() => release());

const TIMEOUT = 120_000;

// Durable actors + fixed keys = state bleeding across suite runs; randomize.
const fresh = (label: string) => `${label}-${crypto.randomUUID()}`;

test(
  "join, chat, and the scheduled Admin welcome lands",
  async () => {
    const room = engine.client(ChatRoom).getOrCreate(fresh("room-basic"));

    await room.Initialize({ name: "Sabungan Lobby" });
    const { memberCount } = await room.Join({ name: "Alice" });
    expect(memberCount).toBe(1);

    await room.SendMessage({ sender: "Alice", text: "hello!" });

    // Scheduled delivery is guaranteed, not fast — poll instead of sleeping.
    let history = await room.GetHistory();
    for (let i = 0; i < 40 && history.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 500));
      history = await room.GetHistory();
    }
    expect(history.map((m) => m.sender)).toEqual(["Alice", "Admin"]);
    expect(history[1]!.text).toBe("Welcome, Alice!");
  },
  TIMEOUT,
);

test(
  "typed errors: non-members bounce, moderator error flows to the caller",
  async () => {
    const room = engine.client(ChatRoom).getOrCreate(fresh("room-errors"));
    await room.Join({ name: "Alice" });

    try {
      await room.SendMessage({ sender: "Mallory", text: "let me in" });
      throw new Error("should have thrown");
    } catch (e) {
      if (!ChatRoom.is.MemberNotInRoom(e)) throw e;
      expect(e.name).toBe("Mallory");
    }

    try {
      await room.SendMessage({ sender: "Alice", text: "buy my spam" });
      throw new Error("should have thrown");
    } catch (e) {
      if (!Moderator.is.BannedWords(e)) throw e;
      expect(e.reason).toBe("no spam allowed");
    }

    const history = await room.GetHistory();
    expect(history.filter((m) => m.sender !== "Admin")).toEqual([]);
  },
  TIMEOUT,
);

test(
  "a failed handler leaves state untouched (draft discarded)",
  async () => {
    const room = engine.client(ChatRoom).getOrCreate(fresh("room-atomic"));
    await room.Join({ name: "Bob" });

    try {
      await room.Leave({ name: "NotHere" });
    } catch (e) {
      expect(ChatRoom.is.MemberNotInRoom(e)).toBe(true);
    }

    const { memberCount } = await room.Join({ name: "Cara" });
    expect(memberCount).toBe(2);
  },
  TIMEOUT,
);
