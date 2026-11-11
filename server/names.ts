/** Plain cat names the plus button offers first. */
const CATS = [
  "Whiskers", "Tabby", "Mittens", "Patches", "Simba", "Nala", "Jinx", "Kiki",
  "Soot", "Bean", "Muffin", "Ginger", "Daisy", "Blaze", "Zippy", "Astro",
  "Purr", "Bluebell", "Catnip", "Breeze", "Petal", "Amber", "Orion", "Moon",
  "Otis", "Pippin", "Chip", "Dill", "Nutmeg", "Cloud", "Jet", "Opal",
  "Zoom", "Buttercup", "Twirl", "Lyra", "Zigzag", "Ramen", "Gherkin", "Cinnamon",
  "Crumbs", "Bao", "Parsley", "Olly", "Mocha", "Toffee", "Thicket", "Figaro",
  "Junie", "Lichen", "Pebbles", "Rico", "Skylar", "Tulip", "Leo", "Snowball",
  "Ash", "Mimi", "Lime", "Violet", "Bud", "Radish", "Smokey", "Socks",
  "Inky", "Tiger", "Bumble", "Oscar", "Salem", "Misty", "Blink", "Felix",
  "Pounce", "Shadow", "Boots", "Oreo", "Pumpkin", "Peanut", "Milo", "Marmalade",
  "Cleo", "Chloe", "Lucy", "Sophie", "Lily", "Bella", "Max", "Charlie",
  "Oliver", "Jasper", "Louie", "Benny", "Hank", "Gus", "Archie", "Winston",
  "Binx", "Marble", "Tigger", "Coco", "Midnight", "Smudge", "Nibbles", "Pudding",
];

/** Put in front of a cat name once every plain name is taken, so the plus button keeps making new ones. */
const WORDS = [
  "Little", "Big", "Tiny", "Fluffy", "Sir", "Lady", "Captain", "Baby", "Old", "Young",
  "Sleepy", "Sneaky", "Lucky", "Fancy", "Fuzzy", "Quick", "Quiet", "Bold", "Shy", "Happy",
  "Silver", "Golden", "Snowy", "Dusty", "Velvet", "Cosy", "Wild", "Gentle", "Brave", "Sweet",
];

const CAT_SET = new Set(CATS.map((name) => name.toLowerCase()));
const WORD_SET = new Set(WORDS.map((word) => word.toLowerCase()));

function freeOne(options: readonly string[], used: Set<string>): string | undefined {
  const free = options.filter((name) => !used.has(name.toLowerCase()));
  if (free.length === 0) return undefined;
  return free[Math.floor(Math.random() * free.length)];
}

function numbered(base: string, used: Set<string>): string {
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** A cat name no bot already has. Plain names first, then "Little Whiskers", then "Whiskers 2", and so on. */
export function pickBotName(taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.trim().toLowerCase()));
  const plain = freeOne(CATS, used);
  if (plain) return plain;
  const paired = WORDS.flatMap((word) => CATS.map((cat) => `${word} ${cat}`));
  const combo = freeOne(paired, used);
  if (combo) return combo;
  const base = paired[Math.floor(Math.random() * paired.length)] ?? CATS[0];
  return numbered(base, used);
}

/** A name pickBotName could have given ("Whiskers", "Little Whiskers", "Whiskers 2"). */
export function isPickedBotName(name: string): boolean {
  const base = name.trim().toLowerCase().replace(/ \d+$/, "");
  if (CAT_SET.has(base)) return true;
  const space = base.indexOf(" ");
  if (space <= 0) return false;
  return WORD_SET.has(base.slice(0, space)) && CAT_SET.has(base.slice(space + 1));
}
