// Dev server ports under each space, like the herdr TUI sidebar's
// $fe $be $fe_agent $be_agent tokens. A herdr-dev.sh watcher (monask-fullstack)
// writes ~/.local/state/herdr-dev/<folder path>.json every 5 s while one of its
// task's servers listens:
//   { space, base, task, until (epoch s), fe: { port, owner }, be: { port, owner } }
// owner: "user" (a herdr tab or a person), "agent" (agent-dev.sh), or null (off).
// An entry past `until` (its watcher died) is ignored.
import * as fs from "fs/promises";
import { home } from "herdr";

export const portsDir = () => `${home()}/.local/state/herdr-dev`;

/** space id -> its entries, sorted by task. Missing folder: none. */
export async function readPorts() {
  const dir = portsDir(), now = Date.now() / 1000;
  /** @type {Record<string, any[]>} */
  const out = Object.create(null); // a space named "__proto__" stays a plain key
  let names;
  try { names = await fs.readdir(dir); } catch { return out; }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let r;
    try { r = JSON.parse(await fs.readFile(`${dir}/${name}`, "utf8")); } catch { continue; }
    if (!r?.space || !(r.until > now) || !(r.fe?.owner || r.be?.owner)) continue;
    (out[r.space] ??= []).push(r);
  }
  for (const list of Object.values(out)) list.sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.task).localeCompare(String(b.task)));
  return out;
}

/** The pieces of one entry's line, as the TUI draws them: "🧑 fe:3011 · be:5010",
 *  "🤖 fe:3011 · be:5010", or mixed "fe:3011 · 🤖 be:5010" (only 🤖 then, to stay narrow).
 *  A person's servers in yellow (ansi3), an agent's in cyan (ansi6).
 *  @param {any} r an entry from readPorts  @param {Record<string, string>} t theme() */
export function portPieces(r, t) {
  const agentUp = r.fe?.owner === "agent" || r.be?.owner === "agent";
  let person = agentUp ? "" : "🧑 ", bot = "🤖 ";
  const out = [];
  for (const s of ["fe", "be"]) {
    const owner = r[s]?.owner;
    if (!owner) continue;
    const mark = owner === "agent" ? bot : person;
    if (owner === "agent") bot = ""; else person = "";
    out.push({ text: `${mark}${s}:${r[s].port}`, color: owner === "agent" ? t.ansi6 : t.ansi3 });
  }
  return out;
}

export const PORT_LINE = 16;
