/**
 * Counted nouns, written out.
 *
 * The interface reached for `${n} layer(s)` in a couple of dozen places, which is wrong at
 * every value it can hold: "1 layer(s)" and "3 layer(s)" are both something nobody would type
 * by hand. It is also the shape that does not survive translation, because the plural rule is
 * a property of the language rather than a suffix you can bolt onto the singular.
 *
 * So the count and the noun are chosen together and returned as one string. Irregular plurals
 * are passed in rather than guessed: `count(1, "photograph")` is fine, `count(2, "photograph")`
 * is fine, and anything English declines oddly gets its plural given explicitly.
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : pluralForm ?? `${singular}s`;
}

/** The count and its noun together: `count(1, "layer")` is "1 layer", `count(0, "layer")` is "0 layers". */
export function count(value: number, singular: string, pluralForm?: string): string {
  return `${value.toLocaleString()} ${plural(value, singular, pluralForm)}`;
}
