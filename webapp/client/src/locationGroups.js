/**
 * Groups the model's location names by brand, for the Admin page's access
 * picker — so a whole brand can be given in one click.
 *
 * Display only: access is stored and enforced as the plain location names, so
 * changing a rule here never changes anyone's access. Rules are checked in
 * order against the start of the name, ignoring case; the first match wins and
 * anything unmatched falls into the last group.
 */
const RULES = [
  ['BBT', /^bbt\b/i],
  ['Chilli Pepper', /^chili pepper\b/i],
  ['Forevermore', /^fm\b/i],
  ['Just C', /^just c\b/i], // not "Just Catering"
  ['Mishmash', /^mm-/i],
  ['Pattie Pattie', /^(pattie|pp\b)/i],
  ['Shawarma Shakir', /^shakir\b/i],
  ['Slice', /^slice\b/i],
  ['Tabel', /^t[-.]/i],
  ['Yelo Pizza', /^(r&d )?yelo\b/i],
]

export const OTHER_GROUP = 'Warehouse, offices & other'

export const groupOf = (location) => RULES.find(([, re]) => re.test(location.trim()))?.[0] ?? OTHER_GROUP

/** [{ name, locations: [...] }] in the rule order, with the catch-all last; empty groups left out. */
export function groupLocations(locations) {
  const by = new Map([...RULES.map(([name]) => [name, []]), [OTHER_GROUP, []]])
  for (const l of locations) by.get(groupOf(l)).push(l)
  return [...by]
    .filter(([, list]) => list.length)
    .map(([name, list]) => ({ name, locations: list.sort((a, b) => a.localeCompare(b)) }))
}
