import { Converter } from "opencc-js/t2cn";

// LRCLIB stores most Chinese songs in Simplified script, while YouTube often shows Traditional or auto-translated titles.
export const toSimplifiedChinese: (value: string) => string = Converter({ from: "tw", to: "cn" });
