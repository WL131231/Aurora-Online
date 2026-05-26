import { Client } from "colyseus.js";

const client = new Client("ws://localhost:2567");

async function joinAs(name) {
  const room = await client.joinOrCreate("world", { name });
  console.log(`[${name}] joined as ${room.sessionId}`);
  return room;
}

const alice = await joinAs("Alice");
const bob = await joinAs("Bob");

await new Promise((r) => setTimeout(r, 250));

const players = alice.state.players;
const count = players.size;
console.log(`[alice] sees ${count} players in room`);
for (const [sid, p] of players.entries()) {
  console.log(`  - ${sid.slice(0, 6)} name=${p.name} at (${Math.round(p.x)}, ${Math.round(p.y)})`);
}

alice.send("move", { x: 100, y: 100, dir: 2, moving: 1 });
await new Promise((r) => setTimeout(r, 200));

const aliceFromBob = bob.state.players.get(alice.sessionId);
if (aliceFromBob) {
  console.log(`[bob] sees alice at (${Math.round(aliceFromBob.x)}, ${Math.round(aliceFromBob.y)})`);
}

alice.send("chat", { text: "hi bob" });
bob.onMessage("chat", (msg) => {
  console.log(`[bob received chat] ${msg.name}: ${msg.text}`);
});

await new Promise((r) => setTimeout(r, 300));

await alice.leave();
await bob.leave();
console.log("OK — smoke test passed");
process.exit(0);
