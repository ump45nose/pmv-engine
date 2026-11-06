import type { Bible, Character } from "../schema/bible";
import type { Pose, Shot } from "../schema/shots";

const FRAMING: Record<Shot["framing"], [name: string, description: string]> = {
  wide: ["wide shot", "the whole stage and its surroundings in view, characters small in the frame"],
  full: ["full shot", "characters seen from head to toe"],
  medium: ["medium shot", "characters framed from about the waist up"],
  "medium-close": ["medium close-up", "characters framed from about the chest up"],
  "close-up": ["close-up", "head and shoulders"],
  "extreme-close-up": ["extreme close-up", "part of the face or a single detail"],
};

/** The shot's characters, in shot order. */
export function cast(bible: Bible, shot: Shot): Character[] {
  return shot.characters.map((id) => {
    const character = bible.characters.find((c) => c.id === id);
    if (!character) throw new Error(`shot ${shot.id}: character "${id}" is not in bible/characters.json`);
    return character;
  });
}

/** Reference images of the shot's characters, in the order the prompts number them. */
export const characterRefs = (bible: Bible, shot: Shot) => cast(bible, shot).flatMap((c) => c.refs);

function whoIsWho(characters: Character[], first: number): string {
  let n = first;
  return characters
    .map((c) => {
      const [a, b] = [n, n + c.refs.length - 1];
      n = b + 1;
      return a === b ? `Reference image ${a} shows ${c.name}` : `Reference images ${a}-${b} show ${c.name}`;
    })
    .join("; ");
}

const list = (characters: Character[], field: "lock" | "instrument") => characters.map((c) => `- ${c.name}: ${c[field]}`).join("\n");

/** Prompt for a shot's base frame, drawn from the character refs. */
export function basePrompt(bible: Bible, shot: Shot): string {
  const characters = cast(bible, shot);
  const [framing, framed] = FRAMING[shot.framing];
  const parts: string[] = [];
  if (characters.length > 0) {
    parts.push(
      `${whoIsWho(characters, 1)}. Use the characters in the reference images as the same identities: do not redesign them or create similar-looking new characters. ` +
        "Keep each face, hairstyle, colour scheme, outfit, accessory and instrument as in the references. " +
        "The references are character sheets: take identity from them, not layout, background or lighting.",
      `Character lock (only these characters appear in the frame):\n${list(characters, "lock")}`,
    );
  }
  parts.push(`Scene: ${shot.base}`, `Framing: ${framing}, ${framed}. One full-frame film still.`);
  if (characters.length > 0) parts.push(`Instruments:\n${list(characters, "instrument")}`);
  parts.push(`Art direction: ${bible.artDirection}`, `Avoid: ${bible.negative}`);
  return `${parts.join("\n\n")}\n`;
}

/** Prompt for a pose variant: an edit of the base frame, which is reference image 1. */
export function variantPrompt(bible: Bible, shot: Shot, pose: Pose): string {
  if (pose.edit === null) throw new Error(`shot ${shot.id} pose ${pose.id} is a base frame, not a variant`);
  const characters = cast(bible, shot);
  const [framing] = FRAMING[shot.framing];
  const head = ["Reference image 1 is the base frame of this shot: edit it."];
  if (characters.length > 0) head.push(`${whoIsWho(characters, 2)}; use them for identity only.`);
  const parts = [
    head.join(" "),
    `Change only this: ${pose.edit}`,
    `Keep everything else as in reference image 1: the camera position and the ${framing} framing, composition, background, lighting, colours and line style` +
      (characters.length > 0 ? ", and each character's face, hairstyle, outfit, accessories and instrument" : "") +
      ". Do not redesign the characters, redraw the background or move the camera.",
  ];
  if (characters.length > 0) parts.push(`Character lock:\n${list(characters, "lock")}`, `Instruments:\n${list(characters, "instrument")}`);
  parts.push(`Art direction: ${bible.artDirection}`, `Avoid: ${bible.negative}`);
  return `${parts.join("\n\n")}\n`;
}
